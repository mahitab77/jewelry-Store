// Requires a production build, a disposable loopback PostgreSQL cluster, and
// existing Playwright/Chromium. Creates no permanent catalogue or browser data.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { databaseConfig, isLoopback } from "../src/lib/db/config.ts";
import { runMigrations } from "../db/tools/migrate.ts";
import { seedDevelopment, developmentId as id } from "../db/tools/seed.ts";

const token = randomUUID().replaceAll("-", "");
const database = `lapalme_test_storefront_${token}`;
const role = `lapalme_browser_reader_${token}`;
const origin = "http://127.0.0.1:3110";
const servers: ChildProcess[] = [];
let admin: pg.Pool;
let data: pg.Pool;
let databaseCreated = false;
let roleCreated = false;
// The optional existing Playwright module is resolved at runtime; no framework dependency.
const moduleName = process.env.PLAYWRIGHT_MODULE ? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href : "playwright";
const { chromium } = await import(moduleName);
let browser: Awaited<ReturnType<typeof chromium.launch>>;
type BrowserPage = Awaited<ReturnType<typeof browser.newPage>>;

async function startServer(port: number, url?: string): Promise<void> {
  // An explicit empty value also blocks Next.js from loading a user's .env.local
  // connection for the missing-configuration test server.
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: url ?? "", SITE_URL: "https://catalogue.example.invalid" };
  const server = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)],
    { env, stdio: "ignore", windowsHide: true });
  servers.push(server);
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error("Local storefront test server exited before becoming ready.");
    try { if ((await fetch(`http://127.0.0.1:${port}/`)).ok) return; } catch { /* Await startup only. */ }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error("Local storefront test server did not become ready.");
}

before(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL must name an explicitly disposable loopback PostgreSQL cluster.");
  const config = databaseConfig(process.env.TEST_DATABASE_URL);
  if (!isLoopback(config.host ?? "") || process.env.NODE_ENV === "production") throw new Error("Browser fixtures require non-production loopback PostgreSQL.");
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined });
  admin = new pg.Pool({ ...config, max: 1 });
  await admin.query(`CREATE DATABASE "${database}"`);
  databaseCreated = true;
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = `/${database}`;
  await runMigrations(url.toString());
  await seedDevelopment(url.toString(), true);
  data = new pg.Pool(databaseConfig(url.toString()));
  // Test normal stored category paths without changing the permanent dev seed.
  await data.query("UPDATE categories SET slug = substring(slug FROM 5) WHERE slug LIKE 'dev-%'");
  await data.query("UPDATE gemstones SET origin = 'PRIVATE_STOREFRONT_SENTINEL', laboratory = 'PRIVATE_STOREFRONT_SENTINEL', report_reference = 'PRIVATE_STOREFRONT_SENTINEL'");
  // Nine clearly labelled records put a real result on the second 12-item page.
  for (let i = 1; i <= 9; i++) {
    await data.query(`INSERT INTO products(id, slug, name, product_type, sales_mode, status, published_at)
      VALUES ($1, $2, $3, 'REPEATABLE', 'ENQUIRY_ONLY', 'PUBLISHED', '2020-01-01')`,
    [`03000000-0000-4000-8000-${String(i).padStart(12, "0")}`, `browser-preview-${i}`,
      i === 1 ? `[DEVELOPMENT] ${"A considered natural stone piece with a very long name ".repeat(5)}` : `[DEVELOPMENT] Browser preview ${i}`]);
  }
  await admin.query(`CREATE ROLE "${role}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`);
  roleCreated = true;
  await data.query(`GRANT USAGE ON SCHEMA public TO "${role}"`);
  await data.query(`GRANT SELECT ON categories, collections, products, product_categories, product_collections,
    product_variants, product_prices, product_media, gemstones, product_gemstones, inventory TO "${role}"`);
  url.username = role;
  url.password = "";
  await startServer(3110, url.toString());
  await startServer(3111);
  await startServer(3112, "postgresql://unreachable@127.0.0.1:1/lapalme_test_unreachable");
  if (process.env.STOREFRONT_SCREENSHOT_DIR) {
    const directory = resolve(process.env.STOREFRONT_SCREENSHOT_DIR);
    assert.ok(!directory.startsWith(resolve(".") + sep), "Screenshots must be outside the repository");
    await mkdir(directory, { recursive: true });
  }
}, { timeout: 60000 });

after(async () => {
  if (browser) await browser.close();
  for (const server of servers) {
    if (server.exitCode === null) {
      const stopped = new Promise<void>((done) => server.once("close", () => done()));
      server.kill();
      await stopped;
    }
  }
  if (data) await data.end();
  if (admin) {
    try {
      assert.match(database, /^lapalme_test_storefront_[a-f0-9]+$/);
      if (databaseCreated) await admin.query(`DROP DATABASE "${database}"`);
      if (roleCreated) await admin.query(`DROP ROLE "${role}"`);
    } finally { await admin.end(); }
  }
});

async function screenshot(page: BrowserPage, name: string) {
  if (process.env.STOREFRONT_SCREENSHOT_DIR) {
    await page.screenshot({ path: join(process.env.STOREFRONT_SCREENSHOT_DIR, name + ".png"), fullPage: false });
  }
}

test("homepage desktop/mobile preserves visual baseline and menu behavior without a database", async () => {
  for (const [name, viewport] of [["desktop", { width: 1440, height: 1000 }], ["mobile", { width: 390, height: 844 }]] as const) {
    const page = await browser.newPage({ viewport, reducedMotion: "reduce", deviceScaleFactor: 1 });
    const response = await page.goto("http://127.0.0.1:3111", { waitUntil: "networkidle" });
    assert.equal(response.status(), 200);
    assert.match(await page.locator("h1").innerText(), /Where Rare Stones Become/);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => [...document.images].filter((i) => i.loading !== "lazy").every((i) => i.complete && i.naturalWidth > 0));
    const current = await page.screenshot();
    if (process.env.HOMEPAGE_BASELINE_DIR) {
      const previous = await readFile(join(process.env.HOMEPAGE_BASELINE_DIR, `homepage-before-${name}.png`));
      if (!current.equals(previous)) {
        // Chromium image/filter rasterization can round a few colour values
        // differently across builds. Keep the original reference and compare
        // pixels: no geometry change or substantial colour change is allowed.
        const difference = await page.evaluate(async ({ baseline, actual }: { baseline: string; actual: string }) => {
          async function pixels(encoded: string) {
            const image = new Image();
            image.src = `data:image/png;base64,${encoded}`;
            await image.decode();
            const canvas = document.createElement("canvas");
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            const context = canvas.getContext("2d")!;
            context.drawImage(image, 0, 0);
            return { width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data };
          }
          const before = await pixels(baseline);
          const after = await pixels(actual);
          if (before.width !== after.width || before.height !== after.height) return { maxDelta: 255, changedFraction: 1 };
          let maxDelta = 0;
          let changed = 0;
          for (let i = 0; i < before.data.length; i += 4) {
            let delta = 0;
            for (let channel = 0; channel < 4; channel++) delta = Math.max(delta, Math.abs(before.data[i + channel] - after.data[i + channel]));
            maxDelta = Math.max(maxDelta, delta);
            if (delta) changed++;
          }
          return { maxDelta, changedFraction: changed / (before.width * before.height) };
        }, { baseline: previous.toString("base64"), actual: current.toString("base64") });
        assert.ok(difference.maxDelta <= 8 && difference.changedFraction <= .025,
          `Homepage ${name} differs from the approved starting source: ${JSON.stringify(difference)}`);
      }
    }
    await screenshot(page, `homepage-after-${name}`);
    if (name === "mobile") {
      await page.getByRole("button", { name: "Open menu", exact: true }).click();
      assert.equal(await page.getByRole("button", { name: "Close menu", exact: true }).getAttribute("aria-expanded"), "true");
      await page.keyboard.press("Escape");
      assert.equal(await page.getByRole("button", { name: "Open menu", exact: true }).getAttribute("aria-expanded"), "false");
    }
    await page.close();
  }
});

test("published listings, categories, editorial collections and pagination use database records", async () => {
  const page = await browser.newPage();
  assert.equal((await page.goto(origin + "/collections")).status(), 200);
  assert.equal(await page.locator("article").count(), 12);
  assert.doesNotMatch(await page.locator("main").innerText(), /dev-draft-ring|dev-archived-ring/);
  assert.ok((await page.locator('meta[name="robots"]').getAttribute("content")).includes("noindex"));
  await page.getByRole("link", { name: "Next page", exact: false }).click();
  await page.waitForURL("**/collections?page=2");
  assert.equal(await page.locator("article").count(), 1);
  await page.getByRole("link", { name: "Previous page", exact: false }).click();
  await page.waitForURL("**/collections");
  assert.equal((await page.goto(origin + "/collections/rings")).status(), 200);
  assert.equal(await page.locator("article").count(), 1);
  assert.match(await page.locator("h1").innerText(), /Rings/);
  assert.equal((await page.goto(origin + "/collections/edit/dev-selections")).status(), 200);
  assert.equal(await page.locator("article").count(), 4);
  await page.close();
});

test("unknown, invalid and unpublished entries return 404; invalid pagination redirects safely", async () => {
  for (const path of ["/collections/unknown-category", "/collections/edit/dev-unpublished", "/collections/edit/unknown",
    "/jewels/unknown-jewel", "/jewels/dev-draft-ring", "/jewels/dev-archived-ring", "/jewels/INVALID"]) {
    const response = await fetch(origin + path, { headers: { "User-Agent": "Googlebot" } });
    assert.equal(response.status, 404, path);
  }
  assert.equal((await fetch(origin + "/collections/unknown-category")).status, 404);
  assert.equal((await fetch(origin + "/jewels/unknown-jewel")).status, 404);
  for (const query of ["page=0", "page=835", "page=x", "page=1&page=2", "sort=invalid"]) {
    const response = await fetch(origin + "/collections?" + query, { redirect: "manual", headers: { "User-Agent": "Googlebot" } });
    assert.equal(response.status, 307, query);
    assert.equal(new URL(response.headers.get("location")!, origin).pathname, "/collections");
  }
});

test("jewel gallery, EGP prices, variants, bespoke and enquiry destinations work", async () => {
  const page = await browser.newPage();
  await page.goto(origin + "/jewels/dev-unique-ring", { waitUntil: "networkidle" });
  assert.match(await page.locator("main").innerText(), /EGP 15,990\.00/);
  assert.match(await page.getByRole("region", { name: "Gemstone specifications" }).innerText(), /1\.25 ct/);
  await page.getByRole("button", { name: "Next photograph", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Show photograph 2" }).getAttribute("aria-pressed"), "true");
  await page.getByRole("button", { name: "Previous photograph", exact: true }).focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.getByRole("button", { name: "Show photograph 1" }).getAttribute("aria-pressed"), "true");
  assert.equal(await page.getByRole("link", { name: "Enquire with the boutique" }).getAttribute("href"), "/#contact");
  assert.match(await page.title(), /unique-ring/);
  assert.equal(await page.locator('link[rel="canonical"]').getAttribute("href"), "https://catalogue.example.invalid/jewels/dev-unique-ring");
  assert.doesNotMatch(await page.content(), /PRIVATE_STOREFRONT_SENTINEL|DATABASE_URL|phase03_validator|lapalme_browser_reader/);
  await page.goto(origin + "/jewels/dev-repeatable-earrings");
  assert.match(await page.locator("main").innerText(), /EGP 2,450\.00/);
  await page.getByRole("radio", { name: /Standard configuration/ }).focus();
  await page.keyboard.press("ArrowDown");
  assert.equal(await page.getByRole("radio", { name: /Development alternate/ }).isChecked(), true);
  assert.match(await page.locator("main").innerText(), /EGP 2,650\.00/);
  assert.match(await page.locator("main").innerText(), /Currently unavailable/i);
  assert.equal(await page.getByRole("link", { name: "Contact the boutique", exact: true }).count(), 1); // Footer only; unavailable variant has no purchase contact action.
  await page.goto(origin + "/jewels/dev-enquiry-pendant");
  assert.match(await page.locator("main").innerText(), /Price on Request/);
  assert.equal(await page.getByRole("button", { name: "Next photograph", exact: true }).count(), 0);
  await page.goto(origin + "/jewels/dev-bespoke-bracelet");
  assert.match(await page.locator("main").innerText(), /Photography is available/);
  assert.equal(await page.getByRole("link", { name: "Discuss a bespoke piece" }).getAttribute("href"), "/#appointment");
  assert.equal(await page.getByRole("button", { name: /Add to cart|checkout/i }).count(), 0);
  await page.close();
});

test("one-of-a-kind stock and empty collections stay distinct from unavailable databases", async () => {
  const page = await browser.newPage();
  await data.query("UPDATE inventory SET on_hand = 0 WHERE variant_id = $1", [id(201)]);
  try {
    await page.goto(origin + "/jewels/dev-unique-ring");
    assert.match(await page.locator("main").innerText(), /Currently unavailable/i);
    assert.doesNotMatch(await page.locator("main").innerText(), /Available to purchase/i);
  } finally { await data.query("UPDATE inventory SET on_hand = 1 WHERE variant_id = $1", [id(201)]); }
  await data.query("UPDATE products SET status = 'DRAFT' WHERE status = 'PUBLISHED'");
  try {
    assert.equal((await page.goto(origin + "/collections/rings")).status(), 200);
    assert.match(await page.locator("main").innerText(), /no published pieces/);
  } finally { await data.query("UPDATE products SET status = 'PUBLISHED' WHERE published_at IS NOT NULL"); }
  for (const path of ["/collections", "/collections/rings", "/jewels/dev-unique-ring"]) {
    assert.equal((await page.goto("http://127.0.0.1:3111" + path)).status(), 200);
    assert.match(await page.locator("main").innerText(), /collection is being prepared/);
    assert.equal((await page.goto("http://127.0.0.1:3112" + path)).status(), 200);
    assert.match(await page.locator("main").innerText(), /temporarily unavailable/);
  }
  await page.close();
});

test("desktop/tablet/mobile have no runtime errors, broken images, overflow or dead navigation", async () => {
  for (const [name, viewport] of [["desktop", { width: 1440, height: 1000 }], ["tablet", { width: 768, height: 1024 }], ["mobile", { width: 390, height: 844 }]] as const) {
    const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (error: Error) => errors.push(error.message));
    page.on("console", (message: { type(): string; text(): string }) => { if (message.type() === "error") errors.push(message.text()); });
    for (const [label, path] of [["collections", "/collections"], ["category", "/collections/rings"], ["jewel", "/jewels/dev-unique-ring"], ["long-title", "/jewels/browser-preview-1"]]) {
      assert.equal((await page.goto(origin + path, { waitUntil: "networkidle" })).status(), 200);
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.locator("nextjs-portal").count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name}: ${path}`);
      assert.equal(await page.evaluate(() => [...document.images].some((i) => i.complete && i.naturalWidth === 0)), false);
      assert.equal(await page.locator('a[href="/cart"],a[href="/checkout"],button:has-text("Add to Cart")').count(), 0);
      await screenshot(page, `${label}-${name}`);
      if (label === "collections") {
        await page.locator("article").first().scrollIntoViewIfNeeded();
        await page.waitForFunction(() => [...document.images].filter((image) => {
          const rect = image.getBoundingClientRect(); return rect.top < innerHeight && rect.bottom > 0;
        }).every((image) => image.complete && image.naturalWidth > 0));
        await screenshot(page, `grid-${name}`);
      }
    }
    if (name !== "desktop") {
      await page.getByRole("button", { name: "Open menu", exact: true }).click();
      await page.getByRole("navigation", { name: "Site sections", exact: true }).getByRole("link", { name: "Collections", exact: true }).click();
      await page.waitForURL("**/collections");
      assert.equal(await page.getByRole("button", { name: "Open menu", exact: true }).getAttribute("aria-expanded"), "false");
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
});

const editorialRoutes = [
  ["/bespoke", "From your vision, a personal heirloom."],
  ["/gemstones", "Colour, light, and individual character."],
  ["/maison", "A house shaped by personal commissions."],
  ["/services", "A little attention, thoughtfully given."],
  ["/appointment", "A conversation, shaped around you."],
  ["/contact", "Speak with the maison."],
] as const;

test("six editorial routes have metadata, semantic headings and truthful contact states without database configuration", async () => {
  const page = await browser.newPage();
  for (const [path, heading] of editorialRoutes) {
    assert.equal((await page.goto("http://127.0.0.1:3111" + path, { waitUntil: "networkidle" })).status(), 200);
    assert.equal(await page.locator("h1").count(), 1);
    assert.equal(await page.locator("h1").innerText(), heading);
    assert.equal(await page.locator("header.site-header").count(), 1);
    assert.match(await page.title(), /La Palme/);
    assert.ok((await page.locator('meta[name="description"]').getAttribute("content")).length > 30);
    const canonical = page.locator('link[rel="canonical"]');
    if (await canonical.count()) assert.equal(await canonical.getAttribute("href"), "https://catalogue.example.invalid" + path);
    assert.equal(await page.locator('form,input[type="date"],input[type="time"],a[href^="tel:"],a[href*="wa.me"]').count(), 0);
    assert.equal(await page.locator('a[href^="mailto:"]').count(), 0);
    assert.doesNotMatch(await page.locator("main").innerText(), /contact@lapalmedorgems\.com|successfully submitted|appointment confirmed/i);
    if (path === "/contact" || path === "/appointment") assert.match(await page.locator("main").innerText(), /Contact details are being confirmed/);
  }
  await page.close();
});

test("shared footer and mobile navigation reach every editorial page without duplicate headers", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(origin + "/collections");
  for (const [path, heading] of editorialRoutes) {
    const link = page.locator(`footer a[href="${path}"]`);
    assert.equal(await link.count(), 1);
    await link.click();
    await page.waitForURL("**" + path);
    assert.equal(await page.locator("h1").innerText(), heading);
    assert.equal(await page.locator("header.site-header").count(), 1);
  }
  await page.getByRole("button", { name: "Open menu", exact: true }).click();
  await page.getByRole("navigation", { name: "Site sections", exact: true }).getByRole("link", { name: "Bespoke", exact: true }).click();
  await page.waitForURL("**/bespoke");
  assert.equal(await page.getByRole("button", { name: "Open menu", exact: true }).getAttribute("aria-expanded"), "false");
  await page.getByRole("link", { name: "Book", exact: true }).click();
  await page.waitForURL("**/appointment");
  await page.close();
});

test("bespoke reuses the four-step carousel and FAQ keyboard interaction", async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  await page.goto(origin + "/bespoke");
  assert.equal(await page.locator(".bespoke-carousel-section").count(), 1);
  assert.equal(await page.locator(".bespoke-step-card").count(), 4);
  await page.getByRole("button", { name: "Show next bespoke appointment step", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.bespoke-step-card[data-active="true"] h3')?.textContent === "Refine with a Designer");
  await page.getByRole("button", { name: "Show previous bespoke appointment step", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector('.bespoke-step-card[data-active="true"] h3')?.textContent === "Share Your Vision");
  await page.locator("summary").first().focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("details").first().getAttribute("open"), "");
  await page.close();
});

test("editorial desktop/tablet/mobile layouts, local imagery, internal links and console remain healthy", async () => {
  for (const [name, viewport] of [["desktop", { width: 1440, height: 1000 }], ["tablet", { width: 768, height: 1024 }], ["mobile", { width: 390, height: 844 }]] as const) {
    const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (error: Error) => errors.push(error.message));
    page.on("console", (message: { type(): string; text(): string }) => { if (message.type() === "error") errors.push(message.text()); });
    for (const [path] of editorialRoutes) {
      await page.goto(origin + path, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${name} ${path}`);
      assert.equal(await page.locator("nextjs-portal").count(), 0);
      await screenshot(page, `editorial-${path.slice(1)}-${name}`);
      await page.locator("footer").scrollIntoViewIfNeeded();
      assert.equal(await page.evaluate(() => [...document.images].some((image) => image.complete && image.naturalWidth === 0)), false);
      const imageSources: string[] = await page.locator("main img").evaluateAll((images: HTMLImageElement[]) => images.map((image) => image.getAttribute("src")!));
      for (const source of new Set(imageSources)) assert.equal((await fetch(new URL(source, origin))).status, 200, "Editorial image reference");
      const internalLinks: string[] = await page.locator('main a[href^="/"],footer a[href^="/"]').evaluateAll((links: HTMLAnchorElement[]) => links.map((link) => link.getAttribute("href")!));
      for (const href of new Set(internalLinks)) {
        assert.equal((await fetch(origin + href, { headers: { "User-Agent": "Googlebot" } })).status, 200, href);
      }
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
});
