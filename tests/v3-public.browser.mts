// Exercise retained direct-sales behavior; quotation-only denial has its own suites.
process.env.COMMERCE_MODE = "DIRECT_SALES";
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { adminBrowserHarness } from "./helpers/admin-browser.mts";
import { developmentId as id } from "../db/tools/seed.ts";
import { deliveryDetails } from "./helpers/checkout-data.mts";
const h = adminBrowserHarness(true, true), { origin } = h;
type MatchedResponse = { url(): string; request(): { method(): string } };
let browser: ReturnType<typeof h.current>["browser"], f: ReturnType<typeof h.current>["fixture"];
beforeEach(async () => {
  ({ browser, fixture: f } = h.current());
  await f.data.query("UPDATE categories SET slug=substring(slug FROM 5) WHERE slug LIKE 'dev-%'");
  await f.data.query("UPDATE product_variants SET size_label='54',configuration_label=CASE id WHEN $1 THEN 'Yellow fixture setting' ELSE 'White fixture setting' END,metal_type='Local gold fixture',metal_purity='18K fixture',metal_color=CASE id WHEN $1 THEN 'Yellow' ELSE 'White' END WHERE id=ANY($2::uuid[])", [id(202), [id(202),id(207)]]);
  await f.data.query("UPDATE inventory SET on_hand=CASE variant_id WHEN $1 THEN 25 ELSE 0 END,reserved=0 WHERE variant_id=ANY($2::uuid[])", [id(202), [id(202),id(207)]]);
});
test("homepage and standalone bespoke CTAs open the shared bespoke request while preserving the homepage section", async () => {
  const c = await browser.newContext({ ignoreHTTPSErrors: true, reducedMotion: "reduce" });
  try {
    const page = await c.newPage(); await page.goto(origin + "/", { waitUntil: "networkidle" });
    assert.equal(await page.locator("a.bespoke-carousel-cta:visible").getAttribute("href"), "/contact?intent=BESPOKE");
    assert.equal(await page.locator("#appointment").count(), 1);
    await page.goto(origin + "/bespoke", { waitUntil: "networkidle" });
    const cta = page.locator("a.bespoke-carousel-cta:visible"); assert.equal(await cta.getAttribute("href"), "/contact?intent=BESPOKE");
    await cta.focus(); await page.keyboard.press("Enter"); await page.waitForURL(origin + "/contact?intent=BESPOKE");
    assert.equal(await page.locator("h1").innerText(), "Speak with the maison.");
    assert.match(await page.title(), /contact/i); assert.equal(await page.getByLabel("What would you like to do?",{ exact:true }).inputValue(),"BESPOKE");
  } finally { await c.close(); }
});
test("mobile Escape restores toggle focus and normal menu links retain their destinations", async () => {
  for (const width of [320,768]) {
    const c = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width, height: 900 }, reducedMotion: "reduce" });
    try {
      const page = await c.newPage(); await page.goto(origin + "/collections", { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Open menu", exact: true }).click();
      const panel = page.getByRole("navigation", { name: "Site sections", exact: true }); await panel.getByRole("link").first().focus();
      await page.keyboard.press("Escape"); const toggle = page.getByRole("button", { name: "Open menu", exact: true });
      assert.equal(await toggle.getAttribute("aria-expanded"), "false"); assert.equal(await toggle.evaluate((e: HTMLElement) => e === document.activeElement), true);
      await toggle.click(); await panel.getByRole("link", { name: "Bespoke", exact: true }).click(); await page.waitForURL(origin + "/bespoke");
      assert.equal(await page.getByRole("button", { name: "Open menu", exact: true }).getAttribute("aria-expanded"), "false");
    } finally { await c.close(); }
  }
});
test("stored variant differences remain visible, accessible and usable at all four widths", { timeout: 60000 }, async () => {
  for (const width of [320,768,1024,1440]) {
    const c = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width, height: 900 }, reducedMotion: "reduce" });
    try {
      const page = await c.newPage(); await page.goto(origin + "/jewels/dev-repeatable-earrings", { waitUntil: "networkidle" });
      const yellow = page.getByRole("radio", { name: /54.*Yellow fixture setting.*Yellow/ }), white = page.getByRole("radio", { name: /54.*White fixture setting.*White/ });
      assert.equal(await yellow.count(), 1); assert.equal(await white.count(), 1);
      await white.check(); await page.getByText("Currently unavailable", { exact: true }).waitFor();
      assert.match(await page.locator("main").innerText(), /2,650\.00/); assert.equal(await page.getByRole("button", { name: /Add.*bag/i }).count(), 0);
      await yellow.check(); assert.match(await page.locator("main").innerText(), /2,450\.00/); assert.ok(await page.getByRole("button", { name: /Add.*bag/i }).isVisible());
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); assert.equal(await page.locator("nextjs-portal").count(), 0);
      await h.screenshot(page, "v3-variant-options-" + width);
    } finally { await c.close(); }
  }
});
test("long persisted option text wraps compactly and complete selected specifications remain available", async () => {
  const configuration = "Long configuration ".repeat(13).trim(), metal = "M".repeat(160);
  await f.data.query("UPDATE product_variants SET configuration_label=$2,metal_type=$3,metal_purity=$3,metal_color=$3 WHERE id=$1", [id(202),configuration,metal]);
  const c = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 320, height: 900 }, reducedMotion: "reduce" });
  try {
    const page = await c.newPage(); await page.goto(origin + "/jewels/dev-repeatable-earrings", { waitUntil: "networkidle" });
    const radio = page.getByRole("radio", { name: /Reference DEV-102/ }); assert.ok((await radio.getAttribute("aria-label"))!.includes(configuration));
    const bounds = await radio.locator("..").boundingBox(); assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 321 && bounds.height < 320);
    const spec = page.locator("dl"); assert.ok((await spec.innerText()).includes(configuration)); assert.ok((await spec.innerText()).includes(metal));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  } finally { await c.close(); }
});
test("empty catalogue text has sufficient contrast and catalogue enquiries use current routes", async () => {
  await f.data.query("INSERT INTO categories(name,slug,is_visible) VALUES('Local v3 empty fixture','local-v3-empty',true)");
  const c = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    const page = await c.newPage(); await page.goto(origin + "/collections/local-v3-empty", { waitUntil: "networkidle" });
    const link = page.getByRole("link", { name: "Speak with the boutique", exact: true }); assert.equal(await link.getAttribute("href"), "/contact");
    const ratio = await link.evaluate((e: HTMLElement) => {
      const rgb = (value: string) => value.match(/[\d.]+/g)!.slice(0,3).map(Number), luminance = (channels: number[]) => channels.map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum,c,i) => sum + c * [.2126,.7152,.0722][i],0);
      let parent: Element | null = e, background = ""; while (parent) { background = getComputedStyle(parent).backgroundColor; if (background !== "rgba(0, 0, 0, 0)" && background !== "transparent") break; parent = parent.parentElement; }
      const a = luminance(rgb(getComputedStyle(e).color)), b = luminance(rgb(background)); return (Math.max(a,b) + .05) / (Math.min(a,b) + .05);
    }); assert.ok(ratio >= 4.5, String(ratio));
    await page.goto(origin + "/jewels/dev-enquiry-pendant", { waitUntil: "networkidle" });
    const destination = new URL((await page.getByRole("link", { name: "Request a Quotation", exact: true }).getAttribute("href"))!,origin);
    assert.equal(destination.pathname,"/contact"); assert.equal(destination.searchParams.get("intent"),"QUOTATION"); assert.equal(destination.searchParams.get("product"),"dev-enquiry-pendant"); assert.equal(destination.searchParams.get("variant"),id(203));
  } finally { await c.close(); }
});
test("browse, select, add, multi-digit quantity and checkout preparation retain server safeguards", async () => {
  const c = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 320, height: 900 } });
  try {
    const page = await c.newPage(); await page.goto(origin + "/collections/earrings", { waitUntil: "networkidle" });
    await page.locator('a[href="/jewels/dev-repeatable-earrings"]').first().click(); await page.getByRole("radio", { name: /Yellow fixture setting/ }).check();
    const added = page.waitForResponse((r: MatchedResponse) => r.url() === origin + "/api/cart/items" && r.request().method() === "POST"); await page.getByRole("button", { name: /Add.*bag/i }).click(); assert.equal((await added).status(),200);
    await page.goto(origin + "/cart", { waitUntil: "networkidle" }); const input = page.locator('input[type="number"]');
    await input.fill("12"); const updated = page.waitForResponse((r: MatchedResponse) => r.url().includes("/api/cart/items/") && r.request().method() === "PATCH"); await input.press("Enter"); assert.equal((await updated).status(),200);
    await page.waitForFunction(() => document.querySelector('main [aria-busy="true"]') === null);
    assert.equal((await (await c.request.get(origin + "/api/cart")).json()).cart.items[0].quantity,12);
    assert.deepEqual((await f.data.query("SELECT on_hand,reserved FROM inventory WHERE variant_id=$1", [id(202)])).rows[0], { on_hand:25,reserved:0 });
    await page.getByRole("link", { name: "Continue to checkout", exact: true }).click();
    const details = deliveryDetails(); await page.getByLabel("Full name", { exact: true }).fill(details.fullName); await page.getByLabel("Email address", { exact: true }).fill(details.email); await page.getByLabel("Egyptian mobile number", { exact: true }).fill(details.phone);
    await page.getByRole("radio", { name: "Private Delivery", exact: true }).check(); await page.getByLabel("Governorate", { exact: true }).selectOption(details.governorate); await page.getByLabel("City or area", { exact: true }).fill(details.city); await page.getByLabel("Street address", { exact: true }).fill(details.street);
    const reviewed = page.waitForResponse((r: MatchedResponse) => r.url() === origin + "/api/checkout/review" && r.request().method() === "POST"); await page.getByRole("button", { name: "Review details", exact: true }).click(); assert.equal((await reviewed).status(),200);
    await page.getByRole("region", { name: "Review-ready checkout", exact: true }).waitFor(); assert.equal(await page.getByRole("button", { name: /Pay|Secure Payment/i }).count(),0);
    for (const table of ["orders","payments","inventory_reservations"]) assert.equal((await f.data.query("SELECT count(*)::int AS n FROM " + table)).rows[0].n,0);
  } finally { await c.close(); }
});
