// Shared HTTPS fixture preserves production Secure cookies and strict origins.
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { adminBrowserHarness } from "./helpers/admin-browser.mts";
const harness = adminBrowserHarness();
const { origin, screenshot, signIn } = harness;
let browser: ReturnType<typeof harness.current>["browser"];
let fixture: ReturnType<typeof harness.current>["fixture"];
beforeEach(() => { ({ browser, fixture } = harness.current()); });

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
