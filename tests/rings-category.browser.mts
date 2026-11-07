import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { adminBrowserHarness } from "./helpers/admin-browser.mts";
import { developmentId as id } from "../db/tools/seed.ts";

// Browser plugin not available. Exercise the real production Next server and
// supplied production images through the existing disposable local HTTPS/DB
// fixture. No taxonomy, product, image or request is written to a hosted system.
// Flow: visible DB Rings category -> actual catalogue selection -> quotation.
process.env.COMMERCE_MODE = "QUOTATION_ONLY";
const h = adminBrowserHarness(true, false, false, false, { requests: true });
const { origin, screenshot } = h;
let browser: ReturnType<typeof h.current>["browser"], fixture: ReturnType<typeof h.current>["fixture"];
type Page = Awaited<ReturnType<typeof browser.newPage>>;
const categories: string[] = [];
type Asset = { id: string; production_path: string; production_sha256: string; width: number; height: number };
const manifest = JSON.parse(await readFile(new URL("../rings-production-kit/rings-assets-manifest.json", import.meta.url), "utf8")) as { assets: Asset[] };
const studies = ["R03", "R01", "R12"].map(id => { const asset = manifest.assets.find(asset => asset.id === id)!; assert.ok(asset); return { ...asset, src: asset.production_path.replace(/^public/, "") }; });
beforeEach(() => { ({ browser, fixture } = h.current()); });
afterEach(async () => { while (categories.length) await fixture.data.query("DELETE FROM categories WHERE id=$1", [categories.pop()]); });
async function context(width = 1440) {
  const c = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width, height: 1000 }, reducedMotion: "reduce" });
  c.setDefaultTimeout(15000); c.setDefaultNavigationTimeout(15000); return c;
}
async function category(extra: { slug?: string; parentId?: string; visible?: boolean; description?: string } = {}) {
  const key = randomUUID();
  await fixture.data.query("INSERT INTO categories(id,slug,name,description,parent_id,is_visible) VALUES($1,$2,$3,$4,$5,$6)", [key, extra.slug ?? "rings", extra.slug ? "LOCAL TEST ONLY " + extra.slug : "Rings", extra.description ?? "LOCAL TEST ONLY. A disposable category for the supplied ring design studies and published catalogue selection.", extra.parentId ?? null, extra.visible ?? true]);
  categories.push(key); return key;
}
async function attach(categoryId: string, productIds: string[]) {
  for (const productId of productIds) await fixture.data.query("INSERT INTO product_categories(product_id,category_id) VALUES($1,$2) ON CONFLICT(product_id,category_id) DO NOTHING", [productId, categoryId]);
}
async function product(categoryId: string, extra: { name?: string; description?: string; status?: "DRAFT" | "PUBLISHED" | "ARCHIVED"; future?: boolean; media?: string; variants?: number } = {}) {
  const key = randomUUID(), slug = "local-ring-" + key, name = extra.name ?? "LOCAL TEST ONLY Ring " + key.slice(0, 8), variantIds: string[] = [];
  await fixture.data.query("INSERT INTO products(id,slug,name,description,product_type,sales_mode,status,published_at) VALUES($1,$2,$3,$4,'REPEATABLE','ENQUIRY_ONLY',$5,$6)", [key, slug, name, extra.description ?? "LOCAL TEST ONLY. Synthetic catalogue record with unverified material details.", extra.status ?? "PUBLISHED", extra.future ? "2999-01-01T00:00:00Z" : extra.status === "DRAFT" || extra.status === "ARCHIVED" ? null : "2020-01-01T00:00:00Z"]);
  await attach(categoryId, [key]);
  for (let variantIndex = 0; variantIndex < (extra.variants ?? 1); variantIndex++) {
    const variantId = randomUUID(); variantIds.push(variantId);
    await fixture.data.query("INSERT INTO product_variants(id,product_id,product_type,sku,configuration_label,is_active,display_order) VALUES($1,$2,'REPEATABLE',$3,$4,true,$5)", [variantId, key, "LOCAL-" + variantId.toUpperCase(), `Local synthetic configuration ${variantIndex + 1}`, variantIndex]);
  }
  if (extra.media) await fixture.data.query("INSERT INTO product_media(product_id,external_media_reference,media_type,alt_text,is_primary) VALUES($1,$2,'IMAGE',$3,true)", [key, extra.media, "LOCAL TEST ONLY product photograph"]);
  return { id: key, slug, name, variants: variantIds };
}
async function status(c: Awaited<ReturnType<typeof context>>, path: string, expected: number) {
  const response = await c.request.get(origin + path, { headers: { "User-Agent": "Googlebot" } }); assert.equal(response.status(), expected, path); return response;
}
function card(page: Page, name: string) { return page.locator("main article").filter({ has: page.getByRole("heading", { name, exact: true }) }); }
async function editorial(page: Page, load = true) {
  const figures = page.locator("main figure"); assert.equal(await figures.count(), 3);
  for (const [index, study] of studies.entries()) {
    const figure = figures.nth(index), image = figure.locator("img");
    if (load) { await image.scrollIntoViewIfNeeded(); await image.waitFor({ state: "visible" }); await page.waitForFunction((src: string) => [...document.images].some(image => new URL(image.currentSrc || image.src, location.href).searchParams.get("url") === src && image.complete && image.naturalWidth > 0), study.src); }
    const detail = await image.evaluate((image: HTMLImageElement) => {
      const box = image.getBoundingClientRect(), figure = image.closest("figure")!;
      return { src: new URL(image.currentSrc || image.src, location.href).searchParams.get("url"), srcset: image.srcset, sizes: image.sizes, width: image.getAttribute("width"), height: image.getAttribute("height"), loading: image.getAttribute("loading"), alt: image.alt, objectFit: getComputedStyle(image).objectFit, ratio: box.width / box.height, linked: Boolean(image.closest("a") || figure.querySelector("a")), productIdentity: Boolean(figure.closest("article,[data-product-id],[data-product-slug],[itemtype*='Product']") || figure.querySelector("[data-product-id],[data-product-slug],[itemtype*='Product']")), next: image.getAttribute("data-nimg") };
    });
    assert.equal(detail.src, study.src, study.id); assert.match(detail.srcset, /\/_next\/image\?/); assert.ok(detail.sizes); assert.equal(detail.next, "1");
    assert.equal(Number(detail.width), study.width); assert.equal(Number(detail.height), study.height); assert.equal(detail.objectFit, "contain"); assert.ok(Math.abs(detail.ratio - study.width / study.height) < .02, `${study.id} intrinsic ratio`);
    assert.equal(detail.linked, false, "Editorial imagery must not link to a product."); assert.equal(detail.productIdentity, false, "Editorial imagery must not acquire a catalogue identity."); assert.ok(detail.alt.length > 15); assert.doesNotMatch(detail.alt, /\b(?:gold|silver|platinum|sapphire|ruby|emerald|diamond|certified|certification|IGI|carat)\b/i);
    if (index === 0) assert.notEqual(detail.loading, "lazy"); else assert.equal(detail.loading, "lazy");
  }
  const preloads: string[] = await page.locator('link[rel="preload"][as="image"]').evaluateAll((links: HTMLLinkElement[]) => links.map(link => decodeURIComponent((link.getAttribute("imagesrcset") ?? "") + (link.getAttribute("href") ?? ""))));
  assert.ok(preloads.some(value => value.includes(studies[0].src)), "The supplied R03 hero must be preloaded.");
  for (const study of studies.slice(1)) assert.equal(preloads.some(value => value.includes(study.src)), false, "Secondary design studies stay lazy.");
}

test("canonical Rings requires actual visible taxonomy and other category/editorial routes keep their existing presentation", { timeout: 90000 }, async () => {
  const c = await context();
  try {
    await status(c, "/collections/rings", 404); await status(c, "/rings", 404);
    assert.equal(Number((await fixture.data.query("SELECT count(*) FROM categories WHERE slug='rings'")).rows[0].count), 0);
    const page = await c.newPage();
    for (const path of ["/collections/dev-rings", "/collections/dev-earrings", "/collections/edit/dev-selections"]) {
      await page.goto(origin + path); assert.equal(await page.locator("main figure").count(), 0); assert.equal(await page.getByRole("heading", { name: "Make it personal.", exact: true }).count(), 0); assert.equal(await page.locator('main img[src*="images%2Frings%2F"]').count(), 0);
    }
    const alias = await category({ slug: "ring-studies" }); await attach(alias, [id(101)]); await page.goto(origin + "/collections/ring-studies"); assert.equal(await page.locator("main article").count(), 1); assert.equal(await page.locator("main figure").count(), 0);
    assert.equal(await page.locator("main article").getByRole("link", { name: /^Request a Quotation/ }).count(), 0);
  } finally { await c.close(); }
});

test("an empty real Rings category shows the three supplied studies and honest empty selection without manufactured products", { timeout: 90000 }, async () => {
  const c = await context();
  try {
    await category(); const page = await c.newPage(); assert.equal((await page.goto(origin + "/collections/rings"))!.status(), 200);
    assert.equal(await page.getByRole("heading", { level: 1, name: "Rings", exact: true }).count(), 1); assert.equal(await page.locator("main article").count(), 0); assert.equal(await page.locator('main a[href^="/jewels/"]').count(), 0);
    assert.match(await page.getByRole("region", { name: "Jewelry selection", exact: true }).innerText(), /no published pieces/i); assert.match(await page.locator("main").innerText(), /not product listings or confirmed inventory/);
    await editorial(page);
    for (const study of studies) { const response = await c.request.get(origin + study.src); assert.equal(response.status(), 200); assert.equal(createHash("sha256").update(await response.body()).digest("hex"), study.production_sha256); }
    assert.equal(await page.getByRole("link", { name: "Explore the selection", exact: true }).getAttribute("href"), "#rings-selection"); assert.equal(await page.getByRole("link", { name: "Discuss a bespoke ring", exact: true }).getAttribute("href"), "/contact?intent=BESPOKE");
    await page.locator("main").getByRole("link", { name: "Consult the Designer", exact: true }).click(); await page.waitForURL(origin + "/appointment"); await page.getByRole("heading", { name: "Begin a conversation.", exact: true }).waitFor();
  } finally { await c.close(); }
});

test("a single DB product keeps its real media and quotation context while incomplete specifications remain unknown", { timeout: 90000 }, async () => {
  const c = await context();
  try {
    const rings = await category(); const incomplete = await product(rings, { name: "LOCAL TEST ONLY Ring with incomplete specifications", variants: 2 });
    const page = await c.newPage(); await page.goto(origin + "/collections/rings"); assert.equal(await page.locator("main article").count(), 1);
    const item = card(page, incomplete.name); assert.equal(await item.locator("img").count(), 0); assert.match(await item.innerText(), /A closer look|by appointment/i); assert.match(await item.innerText(), /Price on Request/); assert.doesNotMatch(await item.innerText(), /EGP|sapphire|ruby|emerald|gold|silver|certified/i);
    const quotation = item.getByRole("link", { name: /^Request a Quotation/ }), href = new URL((await quotation.getAttribute("href"))!, origin); assert.equal(href.pathname, "/contact"); assert.equal(href.searchParams.get("intent"), "QUOTATION"); assert.equal(href.searchParams.get("product"), incomplete.slug); assert.equal(href.searchParams.has("variant"), false);
    await quotation.click(); await page.waitForURL(href.href); assert.equal(await page.getByLabel("Selected configuration", { exact: true }).inputValue(), incomplete.variants[0]); assert.match(await page.locator("main").innerText(), new RegExp(incomplete.name));
    await page.goBack(); await page.waitForURL(origin + "/collections/rings"); await page.locator(`main article a[href="/jewels/${incomplete.slug}"]`).click(); await page.waitForURL(origin + `/jewels/${incomplete.slug}`);
    assert.equal(await page.getByRole("region", { name: "Gemstone specifications", exact: true }).count(), 0); assert.doesNotMatch(await page.locator("main").innerText(), /18K|3\.25 g|sapphire|ruby|emerald|certified/i);
    assert.equal(await page.getByRole("radio").count(), 2); await page.getByRole("radio", { name: /Local synthetic configuration 2/ }).check();
    const selected = page.getByRole("link", { name: "Request a Quotation", exact: true }); assert.equal(new URL((await selected.getAttribute("href"))!, origin).searchParams.get("variant"), incomplete.variants[1]);
    await selected.click(); await page.getByRole("heading", { name: "Begin a conversation.", exact: true }).waitFor(); assert.equal(await page.getByLabel("Selected configuration", { exact: true }).inputValue(), incomplete.variants[1]);
  } finally { await c.close(); }
});

test("many real Rings products paginate and sort while every quotation and detail link retains its DB identity", { timeout: 120000 }, async () => {
  const c = await context();
  try {
    const rings = await category(); await attach(rings, [id(101), id(102), id(103), id(104)]);
    for (let index = 0; index < 10; index++) await product(rings, { name: `LOCAL TEST ONLY Ring ${String(10 - index).padStart(2, "0")}`, variants: index % 3 + 1 });
    const expected = (await fixture.data.query("SELECT p.slug,p.name FROM products p JOIN product_categories pc ON pc.product_id=p.id WHERE pc.category_id=$1 AND p.status='PUBLISHED' AND p.published_at<=statement_timestamp() ORDER BY p.name COLLATE \"C\",p.id", [rings])).rows as { name: string; slug: string }[];
    const page = await c.newPage(); await page.goto(origin + "/collections/rings"); assert.equal(await page.locator("main article").count(), 12);
    const actualPhotograph = await card(page, "[DEVELOPMENT] unique-ring").locator("img").getAttribute("src");
    assert.equal(new URL(actualPhotograph!, origin).searchParams.get("url"), "/images/ring-emerald-no-bg.png", "A real product keeps its stored media rather than an editorial substitute.");
    await page.getByRole("navigation", { name: "Sort jewelry", exact: true }).getByRole("link", { name: "Name", exact: true }).click(); await page.waitForURL(origin + "/collections/rings?sort=name_asc");
    assert.deepEqual(await page.locator("main article h2").allTextContents(), expected.slice(0, 12).map(product => product.name));
    await page.getByRole("navigation", { name: "Catalogue pagination", exact: true }).getByRole("link", { name: /Next page/ }).click(); await page.waitForURL(origin + "/collections/rings?page=2&sort=name_asc");
    assert.equal(await page.locator("main article").count(), 2); assert.deepEqual(await page.locator("main article h2").allTextContents(), expected.slice(12).map(product => product.name));
    const links = await page.locator("main article").evaluateAll((items: HTMLElement[]) => items.map(item => ({ detail: item.querySelector<HTMLAnchorElement>('a[href^="/jewels/"]')?.getAttribute("href"), quotation: item.querySelector<HTMLAnchorElement>('a[href^="/contact?"]')?.getAttribute("href") })));
    for (const [index, link] of links.entries()) { assert.equal(link.detail, "/jewels/" + expected[index + 12].slug); assert.equal(new URL(link.quotation!, origin).searchParams.get("product"), expected[index + 12].slug); }
    assert.equal(await page.getByRole("navigation", { name: "Catalogue pagination", exact: true }).getByRole("link", { name: /Next page/ }).count(), 0);
    await page.getByRole("navigation", { name: "Catalogue pagination", exact: true }).getByRole("link", { name: /Previous page/ }).click(); await page.waitForURL(origin + "/collections/rings?sort=name_asc");
    await page.getByRole("navigation", { name: "Sort jewelry", exact: true }).getByRole("link", { name: "Latest", exact: true }).click(); await page.waitForURL(origin + "/collections/rings"); assert.equal(await page.locator("main article").count(), 12);
    await page.goto(origin + "/collections/rings?page=3"); assert.equal(await page.locator("main article").count(), 0); assert.match(await page.locator("main").innerText(), /reached the end of this selection/); assert.equal(await page.locator("main figure").count(), 3);
    await page.getByRole("link", { name: "Back to the first page", exact: true }).click(); await page.waitForURL(origin + "/collections/rings");
  } finally { await c.close(); }
});

test("publication and category visibility boundaries never turn editorial studies into hidden or future products", { timeout: 90000 }, async () => {
  const c = await context();
  try {
    const parent = await category({ slug: "local-hidden-rings-parent", visible: false }), rings = await category({ parentId: parent }); await attach(rings, [id(101)]);
    await status(c, "/collections/rings", 404); await fixture.data.query("UPDATE categories SET is_visible=true WHERE id=$1", [parent]); await status(c, "/collections/rings", 200);
    await fixture.data.query("UPDATE categories SET is_visible=false WHERE id=$1", [rings]); await status(c, "/collections/rings", 404); await fixture.data.query("UPDATE categories SET is_visible=true WHERE id=$1", [rings]);
    const draft = await product(rings, { name: "LOCAL TEST ONLY DRAFT ring must stay private", status: "DRAFT" }), archived = await product(rings, { name: "LOCAL TEST ONLY ARCHIVED ring must stay private", status: "ARCHIVED" }), future = await product(rings, { name: "LOCAL TEST ONLY FUTURE ring must stay private", future: true });
    const collection = randomUUID(); await fixture.data.query("INSERT INTO collections(id,slug,name,status,published_at) VALUES($1,$2,'LOCAL TEST ONLY future ring edit','PUBLISHED','2999-01-01')", [collection, "local-future-rings-" + collection]);
    const page = await c.newPage(); await page.goto(origin + "/collections/rings"); assert.equal(await page.locator("main article").count(), 1);
    const visible = await page.locator("main").innerText(); for (const hidden of [draft, archived, future]) { assert.ok(!visible.includes(hidden.name)); await status(c, "/jewels/" + hidden.slug, 404); }
    assert.ok(!visible.includes("LOCAL TEST ONLY future ring edit")); assert.ok(!visible.includes("[DEVELOPMENT] Unpublished collection"));
    await status(c, "/collections/edit/local-future-rings-" + collection, 404); await editorial(page);
  } finally { await c.close(); }
});

test("missing, unapproved and failed product photographs keep honest product fallbacks beside the real editorial images", { timeout: 90000 }, async () => {
  const c = await context();
  try {
    const rings = await category(), missing = await product(rings, { name: "LOCAL TEST ONLY Missing ring photograph" }), unapproved = await product(rings, { name: "LOCAL TEST ONLY Unavailable ring photograph", media: "https://unapproved.boutique.test/unverified-image.jpg" }), broken = await product(rings, { name: "LOCAL TEST ONLY Failed ring photograph", media: "/images/ring-emerald-no-bg.png" });
    const page = await c.newPage(), errors: string[] = []; page.on("pageerror", () => errors.push("Page runtime error"));
    await page.route("**/_next/image?**", async (route: { request(): { url(): string }; abort(): Promise<void>; continue(): Promise<void> }) => { if (new URL(route.request().url()).searchParams.get("url") === "/images/ring-emerald-no-bg.png") await route.abort(); else await route.continue(); });
    await page.goto(origin + "/collections/rings");
    assert.equal(await page.locator("main article").count(), 3); for (const value of [missing, unapproved]) { assert.equal(await card(page, value.name).locator("img").count(), 0); assert.match(await card(page, value.name).innerText(), /A closer look|by appointment/i); }
    await card(page, broken.name).scrollIntoViewIfNeeded(); await card(page, broken.name).getByRole("img", { name: /photograph unavailable/ }).waitFor(); assert.match(await card(page, broken.name).innerText(), /Photograph temporarily unavailable/);
    for (const value of [missing, unapproved, broken]) { const quotation = new URL((await card(page, value.name).getByRole("link", { name: /^Request a Quotation/ }).getAttribute("href"))!, origin); assert.equal(quotation.searchParams.get("product"), value.slug); }
    await editorial(page); assert.deepEqual(errors, []);
  } finally { await c.close(); }
});

test("Rings hero, long catalogue copy and supplied design studies fit 320, 768, 1024 and 1440 without cropping or runtime errors", { timeout: 150000 }, async () => {
  const normalDescription = "LOCAL TEST ONLY. Explore the published ring selection and discuss a personal design with the boutique.";
  const longDescription = "LOCAL TEST ONLY. " + "A considered ring design discussion with detailed preferences and questions. ".repeat(18);
  const rings = await category({ description: normalDescription });
  await attach(rings, [id(101), id(102), id(103), id(104)]);
  await product(rings, { name: "LOCAL TEST ONLY " + "A long synthetic ring design name ".repeat(8), description: "LOCAL TEST ONLY. " + "Detailed catalogue copy remains readable without inventing material, availability or certification claims. ".repeat(35), variants: 3 });
  for (const width of [320, 768, 1024, 1440]) {
    const c = await context(width);
    try {
      const page = await c.newPage(), errors: string[] = [];
      page.on("pageerror", () => errors.push("Page runtime error")); page.on("console", (message: { type(): string; text(): string }) => { if (message.type() === "error") errors.push(message.text()); });
      assert.equal((await page.goto(origin + "/collections/rings"))!.status(), 200); await page.evaluate(() => document.fonts.ready);
      assert.match(await page.title(), /Rings/); assert.equal(await page.locator("h1").count(), 1); assert.equal(await page.locator("nextjs-portal").count(), 0); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Rings first viewport fits ${width}px`);
      await screenshot(page, `rings-hero-${width}`); await editorial(page); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Rings studies fit ${width}px`); await screenshot(page, `rings-studies-${width}`);
      await page.getByRole("region", { name: "Jewelry selection", exact: true }).scrollIntoViewIfNeeded(); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Rings cards fit ${width}px`); await screenshot(page, `rings-selection-${width}`);
      assert.equal(await page.locator("main article").count(), 5); assert.equal(await page.getByRole("button", { name: /Add.*bag|Add.*cart|Pay/i }).count(), 0); assert.deepEqual(errors, []);
      await fixture.data.query("UPDATE categories SET description=$1 WHERE id=$2", [longDescription, rings]); await page.reload();
      assert.equal(await page.getByText(longDescription, { exact: true }).count(), 1, "Long category copy must remain complete."); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Long Rings category copy fits ${width}px`); await screenshot(page, `rings-long-copy-${width}`);
    } finally { await fixture.data.query("UPDATE categories SET description=$1 WHERE id=$2", [normalDescription, rings]); await c.close(); }
  }
});
