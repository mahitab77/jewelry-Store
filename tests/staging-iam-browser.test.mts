import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, request as httpRequest, type Server } from "node:http";
import type { Socket } from "node:net";
import { LOOPBACK_FIXTURE_TOKEN, STAGING_ORIGIN, loopbackIamBrowserFixture, stagingIamBrowser } from "./helpers/staging-iam-browser.mts";

// Transport simulation only: no application, database, Google credential, hosted
// request, certificate exception, screenshot, trace or persistent browser state.
const sockets = new Set<Socket>();
const received: { path: string; method: string; auth: string; origin: string; cookie: string; site: string }[] = [];
let otherRequests = 0, origin = "", otherOrigin = "", a: Server, b: Server;
let harness: Awaited<ReturnType<typeof loopbackIamBrowserFixture>>;
async function listen(server: Server) {
  server.on("connection", socket => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}
before(async () => {
  b = createServer((_request, response) => { otherRequests++; response.writeHead(200).end("unapproved destination"); });
  otherOrigin = await listen(b);
  a = createServer((request, response) => {
    const path = new URL(request.url!, origin).pathname;
    received.push({ path, method: request.method!, auth: String(request.headers["x-serverless-authorization"] ?? ""),
      origin: String(request.headers.origin ?? ""), cookie: String(request.headers.cookie ?? ""), site: String(request.headers["sec-fetch-site"] ?? "") });
    if (path === "/same-302" || path === "/same-307") { response.writeHead(path.endsWith("307") ? 307 : 302, { Location: origin + "/echo" }).end(); return; }
    if (path === "/foreign-302" || path === "/foreign-307") { response.writeHead(path.endsWith("307") ? 307 : 302, { Location: otherOrigin + "/seen" }).end(); return; }
    if (path === "/echo") { request.resume(); request.once("end", () => response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify({ ok: true }))); return; }
    const embedded = path === "/embedded" ? `<img src="${otherOrigin}/image"><iframe src="${otherOrigin}/frame"></iframe>` : "";
    response.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
    response.end(`<!doctype html><html><head><title>Local IAM transport fixture</title></head><body><h1>Transport fixture</h1>${embedded}<button onclick="window.open('${otherOrigin}/popup')">Open external window</button></body></html>`);
  });
  origin = await listen(a);
  harness = await loopbackIamBrowserFixture({ origin });
}, { timeout: 60_000 });
after(async () => {
  if (harness) await harness.close();
  for (const socket of sockets) socket.destroy();
  for (const server of [a, b]) if (server) await new Promise<void>(done => server.close(() => done()));
});

test("production origin is pinned and overrides/invalid credentials fail before navigation", async () => {
  assert.equal(STAGING_ORIGIN, "https://la-palme-dor-staging-4dedelrv2a-ew.a.run.app");
  await assert.rejects(stagingIamBrowser({ token: "not-an-iam-token" }), /fresh short-lived IAM token/);
  const dummyJwt = "fixture." + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 120 })).toString("base64url") + ".fixture";
  await assert.rejects(stagingIamBrowser({ token: dummyJwt, origin } as Parameters<typeof stagingIamBrowser>[0]), /value withheld/);
  await assert.rejects(loopbackIamBrowserFixture({ origin: STAGING_ORIGIN }), /HTTP loopback origin/);
  await assert.rejects(loopbackIamBrowserFixture({ origin, token: dummyJwt } as Parameters<typeof loopbackIamBrowserFixture>[0]), /does not accept credentials/);
});

test("direct requests preserve browser Origin, Fetch Metadata and cookies while adding only the dummy IAM header", async () => {
  const { page, context } = harness;
  await context.addCookies([{ name: "fixture_guest", value: "memory-only-guest", url: origin, httpOnly: true, sameSite: "Lax" }]);
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  assert.equal(await page.title(), "Local IAM transport fixture");
  assert.equal(await page.locator("h1").innerText(), "Transport fixture");
  const ok = await page.evaluate(async () => (await fetch("/echo", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", credentials: "same-origin" })).ok);
  assert.ok(ok);
  const request = received.filter(item => item.path === "/echo" && item.method === "POST").at(-1)!;
  assert.ok(request.auth === "Bearer " + LOOPBACK_FIXTURE_TOKEN, "The local dummy header was not received.");
  assert.equal(request.origin, origin);
  assert.equal(request.site, "same-origin");
  assert.ok(request.cookie.includes("fixture_guest=memory-only-guest"), "Browser cookie was not preserved.");
  harness.assertHealthy();
});

test("same-origin 302 and 307 redirects are intercepted again without changing method semantics", async () => {
  const { page } = harness;
  await page.goto(origin + "/same-302", { waitUntil: "domcontentloaded" });
  assert.equal(page.url(), origin + "/echo");
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  const ok = await page.evaluate(async () => (await fetch("/same-307", { method: "POST", body: "fixture-only", credentials: "same-origin" })).ok);
  assert.ok(ok);
  for (const path of ["/same-302", "/same-307", "/echo"]) {
    const hits = received.filter(item => item.path === path);
    assert.ok(hits.length > 0 && hits.every(item => item.auth === "Bearer " + LOOPBACK_FIXTURE_TOKEN), "Redirect request lost local authentication.");
  }
  assert.ok(received.some(item => item.path === "/echo" && item.method === "POST" && item.origin === origin));
  harness.assertHealthy();
});

test("foreign 302 and 307 redirects never reach the unapproved origin", async () => {
  const { page } = harness;
  for (const path of ["/foreign-302", "/foreign-307"]) {
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    const denied = await page.evaluate(async (path: string) => {
      try { await fetch(path, { method: path.endsWith("307") ? "POST" : "GET", credentials: "same-origin" }); return false; }
      catch { return true; }
    }, path);
    assert.ok(denied, "Foreign redirect unexpectedly completed.");
  }
  assert.equal(otherRequests, 0);
  assert.ok(harness.metrics().originBlocked >= 2);
  harness.assertHealthy();
});

test("foreign image, iframe and popup destinations receive no requests or token", async () => {
  const { page, context } = harness;
  await page.goto(origin + "/embedded", { waitUntil: "load" });
  const opened = context.waitForEvent("page");
  await page.getByRole("button", { name: "Open external window" }).click();
  const popup = await opened;
  if (!popup.isClosed()) await new Promise<void>(done => popup.once("close", done));
  assert.equal(otherRequests, 0);
  assert.ok(harness.metrics().originBlocked >= 4);
  assert.equal(harness.metrics().unexpectedPages, 1);
  harness.assertHealthy();
});

test("the process-wide egress gate independently rejects an uninstrumented target with a dummy header", async () => {
  const proxy = new URL(harness.fixtureProxyAddress!);
  const status = await new Promise<number>((done, reject) => {
    const request = httpRequest({ hostname: proxy.hostname, port: proxy.port, path: otherOrigin + "/bypass", headers: { Host: new URL(otherOrigin).host,
      "X-Serverless-Authorization": "Bearer " + LOOPBACK_FIXTURE_TOKEN } }, response => { response.resume(); done(response.statusCode!); });
    request.on("error", reject); request.end();
  });
  assert.equal(status, 403);
  assert.equal(otherRequests, 0);
  assert.ok(harness.metrics().proxyBlocked >= 1);
  // Chromium itself must use the gate even when the page's CDP interception is
  // absent, as can happen for a separately managed target/worker/OOPIF.
  assert.ok(await harness.fixtureUninstrumentedGet!(otherOrigin + "/unmanaged-browser-target"));
  assert.equal(otherRequests, 0);
  assert.ok(harness.metrics().proxyBlocked >= 2);
  harness.assertHealthy();
});
