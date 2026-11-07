import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";

// Browser plugin not available. Use the existing production build and cached
// Chromium, without any database, provider, form submission or hosted access.
const moduleName = process.env.PLAYWRIGHT_MODULE ? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href : "playwright";
const { chromium } = await import(moduleName);
type InterceptedRoute = { request(): { method(): string; url(): string }; abort(): Promise<void>; continue(): Promise<void> };
let browser: Awaited<ReturnType<typeof chromium.launch>>, server: ChildProcess, origin: string;
const records: unknown[] = [];
const phase = process.env.GOLD_LABEL_EVIDENCE_PHASE === "before" ? "before" : "after";
const directory = process.env.GOLD_LABEL_EVIDENCE_DIR ? resolve(process.env.GOLD_LABEL_EVIDENCE_DIR) : undefined;
const viewports = [{ width: 1440, height: 1000 }, { width: 1024, height: 1000 }, { width: 768, height: 1000 }, { width: 375, height: 900 }, { width: 320, height: 740 }, { width: 320, height: 1100 }];

before(async () => {
  if (directory) {
    assert.ok(!directory.startsWith(resolve(".") + sep), "Visual evidence must stay outside the repository.");
    await mkdir(directory, { recursive: true });
  }
  const reservation = createServer();
  await new Promise<void>(done => reservation.listen(0, "127.0.0.1", done));
  const address = reservation.address(); assert.ok(address && typeof address !== "string");
  const port = address.port; await new Promise<void>(done => reservation.close(() => done()));
  origin = `http://127.0.0.1:${port}`;
  const disabled = ["DATABASE_URL", "ADMIN_DATABASE_URL", "CART_DATABASE_URL", "PAYMENT_DATABASE_URL", "TEST_DATABASE_URL", "MEDIA_CLEANUP_DATABASE_URL", "BACKUP_DATABASE_URL", "RESTORE_DATABASE_URL", "NEON_STAGING_DIRECT_URL", "BETTER_AUTH_URL", "BETTER_AUTH_SECRET", "ADMIN_TRUSTED_IP_HEADER", "CART_ORIGIN", "CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET", "PAYMOB_SECRET_KEY", "PAYMOB_PUBLIC_KEY", "PAYMOB_HMAC_SECRET", "PAYMOB_API_KEY", "PAYMOB_INTEGRATION_ID", "PAYMOB_OWNER_ID", "PGOPTIONS"];
  server = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    windowsHide: true, stdio: "ignore", env: { ...process.env, ...Object.fromEntries(disabled.map(key => [key, ""])), NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", COMMERCE_MODE: "QUOTATION_ONLY", SITE_URL: origin, SITE_INDEXING_ALLOWED: "false", PAYMENTS_TEST_ENABLED: "false", PAYMENTS_RECONCILIATION_READY: "false", CHECKOUT_DRAFT_RETENTION_READY: "false" },
  });
  let ready = false;
  for (let attempt = 0; attempt < 200; attempt++) {
    if (server.exitCode !== null) throw new Error("Local label-contrast server exited before readiness.");
    try { ready = (await fetch(origin, { signal: AbortSignal.timeout(3000) })).ok; } catch { /* Local startup only. */ }
    if (ready) break;
    await new Promise(done => setTimeout(done, 100));
  }
  assert.ok(ready, "Local label-contrast server must become ready.");
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined });
}, { timeout: 60000 });

after(async () => {
  if (browser) await browser.close();
  if (server && server.exitCode === null) { const stopped = new Promise<void>(done => server.once("close", () => done())); server.kill(); await stopped; }
  if (directory) await writeFile(join(directory, `${phase}.json`), JSON.stringify(records, null, 2));
});

function luminance(rgb: number[]) {
  return rgb.map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
}
function contrast(a: number[], b: number[]) { return (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05); }

for (const viewport of viewports) test(`Small gold labels meet rendered contrast at ${viewport.width}x${viewport.height}`, { timeout: 90000 }, async () => {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: "reduce" });
  let mutations = 0, external = 0; const errors: string[] = [], failures: string[] = [];
  await context.route("**/*", async (route: InterceptedRoute) => {
    const request = route.request();
    if (!["GET", "HEAD"].includes(request.method())) { mutations++; await route.abort(); }
    else if (new URL(request.url()).origin !== origin) { external++; await route.abort(); }
    else await route.continue();
  });
  try {
    const page = await context.newPage(); page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(30000);
    page.on("pageerror", (error: Error) => errors.push(error.message));
    for (const path of ["/", "/bespoke"]) {
      assert.equal((await page.goto(origin + path, { waitUntil: "networkidle" }))!.status(), 200);
      await page.evaluate(() => document.fonts.ready);
      const preserved = await page.evaluate(() => ({
        height: document.documentElement.scrollHeight,
        content: [...document.querySelectorAll("main h1,main h2,main h3,main p,main img,main button")].map(element => {
          const box = element.getBoundingClientRect(), style = getComputedStyle(element);
          return { text: element.textContent?.trim(), x: box.x, y: box.y + scrollY, width: box.width, height: box.height, font: style.font, color: element.matches(".heritage-eyebrow,.bespoke-carousel-eyebrow") ? "label-under-test" : style.color, source: element.getAttribute("src") };
        }),
        transitions: [...document.querySelectorAll(".lp-transition")].map(element => { const style = getComputedStyle(element, "::before"); return { top: style.top, height: style.height, background: style.backgroundImage, mask: style.maskImage }; }),
      }));
      const selectors = path === "/" ? [".bespoke-carousel-eyebrow", ".heritage-eyebrow"] : [".bespoke-carousel-eyebrow"];
      for (const selector of selectors) {
        const label = page.locator(selector); assert.equal(await label.count(), 1); await label.scrollIntoViewIfNeeded();
        const metrics = await label.evaluate((element: HTMLElement) => { const style = getComputedStyle(element), box = element.getBoundingClientRect(); return { text: element.textContent!.trim(), color: style.color, fontSize: parseFloat(style.fontSize), fontWeight: Number(style.fontWeight), x: box.x, y: box.y + scrollY, width: box.width, height: box.height }; });
        const foreground = metrics.color.match(/[\d.]+/g)!.map(Number); assert.equal(foreground[3] ?? 1, 1, "Labels must use opaque text.");
        const ink = await sharp(await label.screenshot({ animations: "disabled", caret: "hide" })).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const originalStyle = await label.getAttribute("style");
        let background: typeof ink;
        try {
          await label.evaluate((element: HTMLElement) => { element.style.setProperty("color", "transparent", "important"); element.style.setProperty("-webkit-text-fill-color", "transparent", "important"); });
          background = await sharp(await label.screenshot({ animations: "disabled", caret: "hide" })).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        } finally { await label.evaluate((element: HTMLElement, value: string | null) => { if (value === null) element.removeAttribute("style"); else element.setAttribute("style", value); }, originalStyle); }
        assert.equal(ink.data.length, background.data.length);
        let minimum = Infinity, maximum = 0, sampledPixels = 0; let worstBackground: number[] = [];
        for (let pixel = 0; pixel < ink.data.length; pixel += 4) {
          // Locate rendered glyphs, then apply WCAG to the declared text color
          // and the actual background under them, not anti-aliased edge colors.
          if (Math.max(...[0, 1, 2].map(channel => Math.abs(ink.data[pixel + channel] - background.data[pixel + channel]))) < 8) continue;
          const rgb = [...background.data.subarray(pixel, pixel + 3)], value = contrast(foreground.slice(0, 3), rgb);
          if (value < minimum) { minimum = value; worstBackground = rgb; }
          maximum = Math.max(maximum, value); sampledPixels++;
        }
        assert.ok(sampledPixels >= 50, "Contrast measurement must contain real visible glyphs.");
        const threshold = metrics.fontSize >= 24 || metrics.fontSize >= 18.6667 && metrics.fontWeight >= 700 ? 3 : 4.5;
        const file = `${phase}-${path === "/" ? "home" : "bespoke"}-${selector.slice(1)}-${viewport.width}x${viewport.height}.png`;
        records.push({ path, viewport, selector, ...metrics, minimum, maximum, threshold, sampledPixels, worstBackground, file, preserved });
        if (directory) {
          await page.evaluate((y: number) => scrollTo(0, y), Math.max(0, Math.floor(metrics.y - 48)));
          await page.screenshot({ path: join(directory, file), clip: { x: 0, y: 0, width: viewport.width, height: Math.ceil(metrics.height + 144) }, animations: "disabled", caret: "hide" });
        }
        if (minimum < threshold) failures.push(`${path} ${metrics.text}: ${minimum.toFixed(2)}:1 < ${threshold}:1`);
      }
      await page.getByRole("button", { name: "Show next bespoke appointment step", exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.bespoke-step-card[data-active="true"] h3')?.textContent === "Refine with a Designer");
      const previous = page.getByRole("button", { name: "Show previous bespoke appointment step", exact: true }); await previous.focus(); await page.keyboard.press("Enter");
      await page.waitForFunction(() => document.querySelector('.bespoke-step-card[data-active="true"] h3')?.textContent === "Share Your Vision");
      assert.equal(await previous.evaluate((element: HTMLButtonElement) => document.activeElement === element && getComputedStyle(element).outlineStyle === "solid"), true);
      if (path === "/bespoke") { await page.locator("summary").first().focus(); await page.keyboard.press("Enter"); assert.equal(await page.locator("details").first().getAttribute("open"), ""); }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
    assert.equal(mutations, 0); assert.equal(external, 0); assert.deepEqual(errors, []); assert.deepEqual(failures, [], "Every small gold label must meet WCAG AA.");
  } finally { await context.close(); }
});
