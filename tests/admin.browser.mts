// HTTPS loopback validation keeps production Secure cookies and strict origins.
// Supply an existing Playwright/Chromium plus temporary test TLS files.
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer as httpsServer, type Server } from "node:https";
import { request as httpRequest } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { adminFixture } from "./helpers/admin-fixture.mts";

const moduleName = process.env.PLAYWRIGHT_MODULE ? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href : "playwright";
const { chromium } = await import(moduleName);
let browser: Awaited<ReturnType<typeof chromium.launch>>;
let fixture: Awaited<ReturnType<typeof adminFixture>>;
let tls: Server;
const servers: ChildProcess[] = [];
const origin = "https://127.0.0.1:3443";
type BrowserPage = Awaited<ReturnType<typeof browser.newPage>>;

async function server(port: number, configured: boolean) {
  const child = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    windowsHide: true, stdio: "ignore", env: { ...process.env, NODE_ENV: "production", DATABASE_URL: "",
      ADMIN_DATABASE_URL: configured ? fixture.authConfig.databaseUrl : "", BETTER_AUTH_URL: configured ? origin : "",
      BETTER_AUTH_SECRET: configured ? fixture.authConfig.secret : "", ADMIN_TRUSTED_IP_HEADER: "" },
  });
  servers.push(child);
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error("Temporary admin server exited before readiness.");
    try { if ((await fetch(`http://127.0.0.1:${port}/admin/login`)).ok) return; } catch { /* Startup only. */ }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error("Temporary admin server did not become ready.");
}

before(async () => {
  fixture = await adminFixture(origin);
  if (!process.env.ADMIN_TEST_TLS_KEY || !process.env.ADMIN_TEST_TLS_CERT) throw new Error("Set temporary local TLS certificate paths; production cookie security is not disabled.");
  await server(3120, true); await server(3121, false);
  const [key, cert] = await Promise.all([readFile(process.env.ADMIN_TEST_TLS_KEY), readFile(process.env.ADMIN_TEST_TLS_CERT)]);
  tls = httpsServer({ key, cert }, (incoming, outgoing) => {
    const upstream = httpRequest({ host: "127.0.0.1", port: 3120, method: incoming.method, path: incoming.url,
      headers: { ...incoming.headers, "x-forwarded-proto": "https", "x-forwarded-host": "127.0.0.1:3443", "x-forwarded-port": "3443" } }, (response) => {
      outgoing.writeHead(response.statusCode ?? 502, response.headers); response.pipe(outgoing);
    });
    upstream.on("error", () => {
      if (!outgoing.headersSent && !outgoing.destroyed) { outgoing.writeHead(502); outgoing.end("Temporary test server unavailable."); }
      else outgoing.destroy();
    });
    outgoing.on("close", () => upstream.destroy());
    incoming.pipe(upstream);
  });
  await new Promise<void>((done) => tls.listen(3443, "127.0.0.1", done));
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined });
  if (process.env.ADMIN_SCREENSHOT_DIR) {
    const directory = resolve(process.env.ADMIN_SCREENSHOT_DIR);
    assert.ok(!directory.startsWith(resolve(".") + sep), "Screenshots must stay outside the repository.");
    await mkdir(directory, { recursive: true });
  }
}, { timeout: 60000 });
beforeEach(async () => { if (fixture) await fixture.data.query("DELETE FROM admin_auth_rate_limits"); });
after(async () => {
  if (browser) await browser.close();
  if (tls) await new Promise<void>((done, reject) => tls.close((error) => error ? reject(error) : done()));
  for (const child of servers) if (child.exitCode === null) {
    const stopped = new Promise<void>((done) => child.once("close", () => done())); child.kill(); await stopped;
  }
  if (fixture) await fixture.close();
});

async function screenshot(page: BrowserPage, name: string) {
  if (process.env.ADMIN_SCREENSHOT_DIR) await page.screenshot({ path: join(process.env.ADMIN_SCREENSHOT_DIR, `${name}.png`) });
}
async function signIn(page: BrowserPage) {
  await page.goto(origin + "/admin/login", { waitUntil: "networkidle" });
  await page.getByLabel("Email address", { exact: true }).fill(fixture.users.OWNER.email);
  await page.getByLabel("Password", { exact: true }).fill(fixture.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(origin + "/admin");
  assert.match(await page.locator("h1").innerText(), /Welcome, Fixture OWNER/);
}

test("unauthenticated requests cannot reach the admin area or its RSC payload", async () => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    const page = await context.newPage();
    await page.goto(origin + "/admin"); await page.waitForURL(origin + "/admin/login");
    assert.equal(await page.locator("h1").innerText(), "Administrator sign-in");
    for (const path of ["/admin", "/admin/future-area", "/admin/future-area?_rsc=fixture"]) {
      const response = await context.request.get(origin + path, { maxRedirects: 0, headers: { RSC: "1" } });
      assert.ok([303, 307].includes(response.status()));
      assert.ok(!((await response.text()).includes("Welcome, Fixture")));
    }
    assert.equal((await context.request.get(origin + "/admin/logout")).status(), 405);
    assert.equal(await page.locator("form").getAttribute("method"), "post");
    assert.equal(await page.getByRole("link", { name: /register|sign up/i }).count(), 0);
  } finally { await context.close(); }
});

test("HTTPS browser login, protected content, sign-out and revoked-cookie replay work", async () => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", () => errors.push("Runtime error"));
    page.on("console", (message: { type(): string }) => { if (message.type() === "error" || message.type() === "warning") errors.push("Console error/warning"); });
    await signIn(page);
    const stored = (await context.cookies()).find((cookie: { name: string }) => cookie.name.endsWith(".session_token"));
    assert.ok(stored?.httpOnly && stored.secure && stored.sameSite === "Strict");
    assert.equal(await page.locator("header").count(), 1);
    assert.equal(await page.getByRole("link", { name: "Not yet available", exact: true }).count(), 0);
    assert.equal(await page.locator("nextjs-portal").count(), 0);
    await page.evaluate(() => document.fonts.ready);
    await screenshot(page, "admin-landing-desktop");
    const html = await page.content();
    assert.ok(!html.includes(fixture.password) && !html.includes(fixture.authConfig.secret) && !html.includes(stored.value));
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.waitForURL(origin + "/admin/login");
    assert.ok(!(await context.cookies()).some((cookie: { name: string }) => cookie.name.endsWith(".session_token")));
    await context.addCookies([stored]);
    await page.goto(origin + "/admin"); await page.waitForURL(origin + "/admin/login");
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
});

test("invalid and disabled credentials stay generic; disabling an active session denies access", async () => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    const page = await context.newPage();
    await page.goto(origin + "/admin/login");
    await page.getByLabel("Email address", { exact: true }).fill(fixture.users.ADMIN.email);
    await page.getByLabel("Password", { exact: true }).fill("an incorrect fixture password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("alert").waitFor();
    const generic = await page.getByRole("alert").innerText();
    assert.ok((await page.getByLabel("Password", { exact: true }).inputValue()).length === 0, "Failed login must leave the password field empty.");
    await fixture.data.query("UPDATE admin_users SET is_active=false WHERE id=$1", [fixture.users.ADMIN.id]);
    try {
      await page.getByLabel("Password", { exact: true }).fill(fixture.password);
      const failed = page.waitForResponse((response: { url(): string; request(): { method(): string } }) => response.url().endsWith("/sign-in/email") && response.request().method() === "POST");
      await page.getByRole("button", { name: "Sign in", exact: true }).click(); await failed;
      await page.getByRole("alert").waitFor();
      assert.equal(await page.getByRole("alert").innerText(), generic);
      assert.ok(page.url().endsWith("/admin/login"));
    } finally { await fixture.data.query("UPDATE admin_users SET is_active=true WHERE id=$1", [fixture.users.ADMIN.id]); }
    await signIn(page);
    await fixture.data.query("UPDATE admin_users SET is_active=false WHERE id=$1", [fixture.users.OWNER.id]);
    try { await page.goto(origin + "/admin"); await page.waitForURL(origin + "/admin/login"); }
    finally { await fixture.data.query("UPDATE admin_users SET is_active=true WHERE id=$1", [fixture.users.OWNER.id]); }
  } finally { await context.close(); }
});

test("desktop and mobile login support keyboard input, clear headings and unclipped layouts", async () => {
  for (const [name, width, height] of [["desktop", 1440, 1000], ["mobile", 390, 844]] as const) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width, height }, reducedMotion: "reduce" });
    try {
      const page = await context.newPage();
      await page.goto(origin + "/admin/login", { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      assert.match(await page.title(), /Administrator Sign-in/);
      assert.equal(await page.locator("h1").count(), 1);
      assert.match(await page.locator('meta[name="robots"]').getAttribute("content"), /noindex/);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await screenshot(page, `admin-login-${name}`);
      await page.getByLabel("Email address", { exact: true }).focus();
      await page.keyboard.type(fixture.users.OWNER.email);
      await page.keyboard.press("Tab");
      assert.equal(await page.locator(":focus").getAttribute("name"), "password");
      await page.keyboard.type(fixture.password);
      await page.keyboard.press("Tab");
      assert.match(await page.locator(":focus").innerText(), /^sign in$/i);
      await page.keyboard.press("Enter"); await page.waitForURL(origin + "/admin");
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await screenshot(page, `admin-landing-${name}`);
      const localStorageCount = await page.evaluate(() => localStorage.length);
      assert.equal(localStorageCount, 0);
    } finally { await context.close(); }
  }
});

test("missing admin configuration leaves public pages healthy and sign-in transparently unavailable", async () => {
  const page = await browser.newPage();
  try {
    assert.equal((await page.goto("http://127.0.0.1:3121/admin/login")).status(), 200);
    assert.match(await page.getByRole("status").innerText(), /currently unavailable/);
    assert.equal(await page.locator("form").count(), 0);
    await page.goto("http://127.0.0.1:3121/admin"); await page.waitForURL("http://127.0.0.1:3121/admin/login");
    for (const path of ["/", "/bespoke", "/gemstones", "/maison", "/services", "/appointment", "/contact"]) assert.equal((await page.goto("http://127.0.0.1:3121" + path)).status(), 200);
  } finally { await page.close(); }
});
