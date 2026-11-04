import assert from "node:assert/strict";
import { after, before, beforeEach } from "node:test";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer as httpsServer, type Server } from "node:https";
import { request as httpRequest } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { adminFixture } from "./admin-fixture.mts";
import { catalogueFixture } from "./catalogue-fixture.mts";
import { cartFixture } from "./cart-fixture.mts";
import { mockCloudinaryConfiguration } from "./cloudinary-mock.mts";
import { paymentFixture } from "./payment-fixture.mts";
import { paymentEnvironment } from "./paymob-mock.mts";
import { orderFixture } from "./order-fixture.mts";
import type { AdminRole } from "../../src/lib/admin/policy.ts";

const moduleName = process.env.PLAYWRIGHT_MODULE ? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href : "playwright";
const { chromium } = await import(moduleName);

export function adminBrowserHarness(catalogue = false, cart = false, payments = false, orders = false, options: { seedCatalogue?: boolean } = {}) {
  let browser: Awaited<ReturnType<typeof chromium.launch>>;
  let fixture: Awaited<ReturnType<typeof adminFixture>> & Partial<Pick<Awaited<ReturnType<typeof cartFixture>>, "cartUrl" | "readerUrl">> & Partial<Pick<Awaited<ReturnType<typeof paymentFixture>>, "paymentUrl">>;
  let tls: Server;
  const servers: ChildProcess[] = [];
  let serverOutput = "";
  const secrets: string[] = [];
  const origin = "https://127.0.0.1:3443";
  async function server(port: number, configured: boolean) {
    const preload = payments && configured ? ["--experimental-strip-types", "--import", pathToFileURL(resolve("tests/helpers/paymob-mock.mts")).href] : catalogue && configured ? ["--experimental-strip-types", "--import", pathToFileURL(resolve("tests/helpers/cloudinary-mock.mts")).href] : [];
    const child = spawn(process.execPath, [...preload, resolve("node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)], {
      windowsHide: true, stdio: cart ? "pipe" : "ignore", env: { ...process.env,...Object.fromEntries(Object.keys(paymentEnvironment).map(key=>[key,""])),...(payments&&configured?paymentEnvironment:{}),
        PAYMENT_DATABASE_URL:payments&&configured?fixture.paymentUrl!:"",PAYMENTS_BROWSER_PRELOAD:payments&&configured?"1":"", NODE_ENV: "production", DATABASE_URL: cart && configured ? fixture.readerUrl! : catalogue && configured ? fixture.authConfig.databaseUrl : "",
        CART_DATABASE_URL: cart && configured ? fixture.cartUrl! : "", CART_ORIGIN: cart && configured ? origin : "",
        CHECKOUT_DRAFT_RETENTION_READY: cart && configured ? "true" : "",
        ADMIN_DATABASE_URL: configured && (!cart || orders) ? fixture.authConfig.databaseUrl : "", BETTER_AUTH_URL: configured && (!cart || orders) ? origin : "",
        BETTER_AUTH_SECRET: configured && (!cart || orders) ? fixture.authConfig.secret : "", ADMIN_TRUSTED_IP_HEADER: "",
        CLOUDINARY_CLOUD_NAME: catalogue && configured ? mockCloudinaryConfiguration.cloudName : "",
        CLOUDINARY_API_KEY: catalogue && configured ? mockCloudinaryConfiguration.apiKey : "",
        CLOUDINARY_API_SECRET: catalogue && configured ? mockCloudinaryConfiguration.apiSecret : "",
        CATALOGUE_BROWSER_PRELOAD: catalogue && configured ? "1" : "" },
    });
    if (cart) { child.stdout?.on("data", (data: Buffer) => { serverOutput += data.toString(); }); child.stderr?.on("data", (data: Buffer) => { serverOutput += data.toString(); }); }
    servers.push(child);
    for (let i = 0; i < 200; i++) {
      if (child.exitCode !== null) throw new Error("Temporary admin server exited before readiness.");
      try { if ((await fetch(`http://127.0.0.1:${port}/admin/login`)).ok) return; } catch { /* Startup only. */ }
      await new Promise((done) => setTimeout(done, 100));
    }
    throw new Error("Temporary admin server did not become ready.");
  }
  before(async () => {
    fixture = orders ? await orderFixture(origin) : payments ? await paymentFixture(origin) : cart ? await cartFixture(origin) : catalogue ? await catalogueFixture(origin, options.seedCatalogue ?? true) : await adminFixture(origin);
    if(payments)for(const[key,value]of Object.entries(paymentEnvironment))if(/KEY|SECRET/.test(key))secrets.push(value);
    if (!process.env.ADMIN_TEST_TLS_KEY || !process.env.ADMIN_TEST_TLS_CERT) throw new Error("Set disposable local TLS paths; production cookie security is never disabled.");
    await server(3120, true); await server(3121, false);
    const [key, cert] = await Promise.all([readFile(process.env.ADMIN_TEST_TLS_KEY), readFile(process.env.ADMIN_TEST_TLS_CERT)]);
    tls = httpsServer({ key, cert }, (incoming, outgoing) => {
      const upstream = httpRequest({ host: "127.0.0.1", port: 3120, method: incoming.method, path: incoming.url,
        headers: { ...incoming.headers, "x-forwarded-proto": "https", "x-forwarded-host": "127.0.0.1:3443", "x-forwarded-port": "3443" } }, (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers); response.pipe(outgoing);
      });
      upstream.on("error", () => {
        if (!outgoing.headersSent && !outgoing.destroyed) { outgoing.writeHead(502); outgoing.end("Temporary test server unavailable."); } else outgoing.destroy();
      });
      outgoing.on("close", () => upstream.destroy()); incoming.pipe(upstream);
    });
    await new Promise<void>((done) => tls.listen(3443, "127.0.0.1", done));
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined });
    if (process.env.ADMIN_SCREENSHOT_DIR) {
      const directory = resolve(process.env.ADMIN_SCREENSHOT_DIR);
      assert.ok(!directory.startsWith(resolve(".") + sep), "Screenshots must stay outside the repository."); await mkdir(directory, { recursive: true });
    }
  }, { timeout: 90000 });
  beforeEach(async () => { if (fixture) { await fixture.data.query("DELETE FROM admin_auth_rate_limits"); if (cart) await fixture.data.query("DELETE FROM cart_rate_limits"); } });
  after(async () => {
    if (browser) await browser.close();
    if (tls) await new Promise<void>((done, reject) => tls.close((error) => error ? reject(error) : done()));
    for (const child of servers) if (child.exitCode === null) { const stopped = new Promise<void>((done) => child.once("close", () => done())); child.kill(); await stopped; }
    if (fixture) await fixture.close();
    if (cart) {
      assert.ok(serverOutput.length <= 65536, "Inspect unexpectedly large cart server output before claiming log privacy.");
      for (const secret of [...secrets, fixture?.cartUrl, fixture?.readerUrl, fixture?.paymentUrl].filter(Boolean) as string[]) assert.ok(!serverOutput.includes(secret), "A guest credential or personal fixture field appeared in temporary server output.");
    }
  });
  return { origin, current: () => ({ browser, fixture }), trackSecret(value: string) { secrets.push(value); }, async signIn(page: Awaited<ReturnType<typeof browser.newPage>>, role: AdminRole = "OWNER") {
    await page.goto(origin + "/admin/login", { waitUntil: "networkidle" });
    await page.getByLabel("Email address", { exact: true }).fill(fixture.users[role].email);
    await page.getByLabel("Password", { exact: true }).fill(fixture.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click(); await page.waitForURL(origin + "/admin");
    assert.ok((await page.locator("h1").innerText()).includes(`Welcome, Fixture ${role}`));
  }, async screenshot(page: Awaited<ReturnType<typeof browser.newPage>>, name: string) {
    if (process.env.ADMIN_SCREENSHOT_DIR) {
      // A public-detail tab may still be foregrounded after the editor round trip.
      // Bring the capture target forward so Chromium can paint it normally.
      await page.bringToFront();
      await page.screenshot({ path: join(process.env.ADMIN_SCREENSHOT_DIR, `${name}.png`), animations: "disabled", caret: "hide", timeout: 30000 });
    }
  } };
}
