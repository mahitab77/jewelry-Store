import { createServer, request as httpRequest } from "node:http";
import { connect, type Socket } from "node:net";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const STAGING_ORIGIN = "https://la-palme-dor-staging-4dedelrv2a-ew.a.run.app";
export const LOOPBACK_FIXTURE_TOKEN = "local-transport-fixture-only-not-an-iam-credential";

type Options = { playwrightModule?: string; chromiumExecutable?: string };
type Metrics = { injected: number; originBlocked: number; proxyBlocked: number; unexpectedPages: number };
async function chromiumEngine(modulePath?: string) {
  return (await import(modulePath ? pathToFileURL(resolve(modulePath)).href : "playwright")).chromium;
}
type Browser = Awaited<ReturnType<Awaited<ReturnType<typeof chromiumEngine>>["launch"]>>;
type Context = Awaited<ReturnType<Browser["newContext"]>>;
type Page = Awaited<ReturnType<Context["newPage"]>>;
type Session = Awaited<ReturnType<Context["newCDPSession"]>>;
type PausedRequest = { requestId: string; request: { url: string; headers: Record<string, string> } };
const safeFailure = () => new Error("Staging browser transport failed; credentials and request details withheld.");

// This process-wide destination gate also covers OOPIFs, workers and new targets
// outside the instrumented page. Production CONNECT tunnels preserve end-to-end
// TLS, the real browser URL, Host, Origin, Fetch Metadata and cookie semantics.
async function destinationGate(origin: string, fixture: boolean, metrics: Metrics) {
  const target = new URL(origin), sockets = new Set<Socket>();
  const server = createServer((incoming, outgoing) => {
    let url: URL;
    try { url = new URL(incoming.url ?? ""); } catch { outgoing.writeHead(403).end(); return; }
    if (!fixture || url.origin !== origin || url.username || url.password || incoming.headers.host !== target.host) {
      metrics.proxyBlocked++; outgoing.writeHead(403).end(); return;
    }
    const headers = { ...incoming.headers };
    delete headers["proxy-connection"]; delete headers["proxy-authorization"];
    const upstream = httpRequest({ hostname: target.hostname, port: target.port, method: incoming.method,
      path: url.pathname + url.search, headers, agent: false }, response => {
      outgoing.writeHead(response.statusCode ?? 502, response.headers); response.pipe(outgoing);
    });
    upstream.on("socket", socket => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
    upstream.on("error", () => { if (!outgoing.headersSent) outgoing.writeHead(502); outgoing.end(); });
    outgoing.once("close", () => upstream.destroy()); incoming.pipe(upstream);
  });
  server.on("connection", socket => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  server.on("connect", (incoming, client, head) => {
    if (fixture || incoming.url !== target.hostname + ":443") {
      metrics.proxyBlocked++; client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); return;
    }
    const upstream = connect(443, target.hostname);
    sockets.add(upstream); upstream.once("close", () => sockets.delete(upstream));
    upstream.once("connect", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      client.pipe(upstream); upstream.pipe(client);
    });
    upstream.on("error", () => client.destroy()); client.on("error", () => upstream.destroy());
    client.once("close", () => upstream.destroy()); upstream.once("close", () => client.destroy());
  });
  server.on("clientError", (_error, socket) => socket.destroy());
  await new Promise<void>((done, reject) => {
    server.once("error", reject); server.listen(0, "127.0.0.1", done);
  });
  const address = server.address();
  if (!address || typeof address === "string") { server.close(); throw safeFailure(); }
  return { address: `http://127.0.0.1:${address.port}`, async close() {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(done => server.close(() => done()));
  } };
}

function recordingDisabled() {
  // Fail before loading Playwright: an already enabled protocol logger could
  // print Fetch.continueRequest headers even if this helper never logs anything.
  for (const key of ["DEBUG", "PWDEBUG", "DEBUG_FILE", "SSLKEYLOGFILE", "CHROME_LOG_FILE"])
    if (process.env[key]) throw new Error("Disable browser/protocol recording before starting this process.");
}

async function browserTransport(origin: string, token: string, options: Options, fixture: boolean, expiresAt: number) {
  recordingDisabled();
  const metrics: Metrics = { injected: 0, originBlocked: 0, proxyBlocked: 0, unexpectedPages: 0 };
  const gate = await destinationGate(origin, fixture, metrics);
  let browser: Browser, context: Context, session: Session, expiry: ReturnType<typeof setTimeout> | undefined;
  let fault = false, closed = false, closing: Promise<void> | undefined;
  async function close() {
    if (closing) return closing;
    closed = true; token = ""; if (expiry) clearTimeout(expiry);
    closing = (async () => {
      try { if (context) await context.close(); } catch { /* Continue cleanup. */ }
      try { if (browser) await browser.close(); } catch { /* Continue cleanup. */ }
      await gate.close();
    })();
    return closing;
  }
  try {
    const modulePath = options.playwrightModule ?? process.env.PLAYWRIGHT_MODULE;
    const chromium = await chromiumEngine(modulePath);
    // Pass OS essentials only, excluding cloud credentials, DB URLs, debugging
    // variables and key-log paths inherited by the operator's Node process.
    const essentials = new Set(["systemroot", "windir", "temp", "tmp", "userprofile", "localappdata", "appdata", "path", "pathext", "comspec", "home", "display", "xauthority", "lang"]);
    const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => essentials.has(key.toLowerCase()) && value !== undefined));
    browser = await chromium.launch({ headless: true, dumpio: false, executablePath: options.chromiumExecutable ?? process.env.CHROMIUM_EXECUTABLE,
      env, proxy: { server: gate.address }, args: ["--proxy-bypass-list=<-loopback>", "--disable-quic", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp"] });
    context = await browser.newContext({ serviceWorkers: "block", ignoreHTTPSErrors: false });
    const page = await context.newPage();
    context.on("page", (other: Page) => { if (other !== page) { metrics.unexpectedPages++; void other.close().catch(() => { fault = true; }); } });
    session = await context.newCDPSession(page);
    await session.send("Network.enable");
    await session.send("Network.setCacheDisabled", { cacheDisabled: true });
    session.on("Fetch.requestPaused", (event: PausedRequest) => {
      void (async () => {
        const url = new URL(event.request.url);
        if (closed || Date.now() >= expiresAt || url.origin !== origin || url.username || url.password) {
          metrics.originBlocked++; await session.send("Fetch.failRequest", { requestId: event.requestId, errorReason: "BlockedByClient" }); return;
        }
        const headers = Object.entries(event.request.headers as Record<string, string>);
        if (headers.some(([name]) => name.toLowerCase() === "x-serverless-authorization")) throw safeFailure();
        await session.send("Fetch.continueRequest", { requestId: event.requestId,
          headers: [...headers.map(([name, value]) => ({ name, value })), { name: "X-Serverless-Authorization", value: "Bearer " + token }] });
        metrics.injected++;
      })().catch(() => { if (!closed) { fault = true; void close(); } });
    });
    await session.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
    expiry = setTimeout(() => { fault = true; void close(); }, Math.max(1, expiresAt - Date.now())); expiry.unref();
    return { page, context, origin, close, metrics: () => ({ ...metrics }), assertHealthy() {
      if (fault || closed || Date.now() >= expiresAt) throw safeFailure();
    }, // Available only for a dummy-token local fixture's process-wide gate test.
    fixtureProxyAddress: fixture ? gate.address : undefined,
    fixtureUninstrumentedGet: fixture ? async (url: string) => {
      // Prove the process-wide gate with page interception absent. This path is
      // exposed only by the fixed-dummy-token fixture, never by production use.
      const blockedBefore = metrics.proxyBlocked;
      let denied = false;
      await session.send("Fetch.disable");
      try { denied = (await page.goto(url, { waitUntil: "domcontentloaded" })).status() === 403; }
      catch { denied = true; } // Chromium may reject a proxy403 as a network error.
      finally { await session.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] }); }
      return denied && metrics.proxyBlocked > blockedBefore;
    } : undefined };
  } catch {
    await close(); throw safeFailure();
  }
}

// No cloud commands, credential acquisition or navigation occurs on import.
// The caller supplies an in-memory short-lived operator token. Do not use
// context.request (it bypasses browser CDP), storage-state files, tracing or HAR.
// Callers must catch UI-operation failures with static/redacted messages too:
// raw Playwright errors can include a failed fill(password) value in call logs.
export async function stagingIamBrowser(options: Options & { token: string }) {
  let expiresAt: number;
  try {
    if (Object.keys(options).some(key => !["token", "playwrightModule", "chromiumExecutable"].includes(key))) throw safeFailure();
    if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(options.token)) throw safeFailure();
    const claims = JSON.parse(Buffer.from(options.token.split(".")[1], "base64url").toString("utf8"));
    expiresAt = Number(claims.exp) * 1000;
    if (!Number.isFinite(expiresAt) || expiresAt - Date.now() < 60_000 || expiresAt - Date.now() > 3_630_000) throw safeFailure();
  } catch { throw new Error("A fresh short-lived IAM token is required; value withheld."); }
  // JWT freshness is local input validation only. Google verifies authenticity
  // and authorization when the separately approved operator invokes Cloud Run.
  return browserTransport(STAGING_ORIGIN, options.token, options, false, expiresAt);
}

// Local transport simulation only: cannot accept or acquire an actual IAM token.
export async function loopbackIamBrowserFixture(options: Options & { origin: string }) {
  if (Object.keys(options).some(key => !["origin", "playwrightModule", "chromiumExecutable"].includes(key)))
    throw new Error("The dummy browser fixture does not accept credentials or browser overrides.");
  const url = new URL(options.origin);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.origin !== options.origin || url.username || url.password)
    throw new Error("The dummy browser fixture requires an exact HTTP loopback origin.");
  return browserTransport(options.origin, LOOPBACK_FIXTURE_TOKEN, options, true, Date.now() + 300_000);
}
