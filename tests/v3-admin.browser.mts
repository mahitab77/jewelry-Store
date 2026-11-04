import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { adminBrowserHarness } from "./helpers/admin-browser.mts";
import { developmentId as id } from "../db/tools/seed.ts";
const h = adminBrowserHarness(true), { origin, signIn, screenshot } = h;
let browser: ReturnType<typeof h.current>["browser"], fixture: ReturnType<typeof h.current>["fixture"];
type Page = Awaited<ReturnType<typeof browser.newPage>>;
type Context = Awaited<ReturnType<typeof browser.newContext>>;
beforeEach(() => { ({ browser, fixture } = h.current()); });
const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));
const alert = (page: Page) => page.locator("main").getByRole("alert");
async function context() { return browser.newContext({ ignoreHTTPSErrors: true, reducedMotion: "reduce" }); }
async function post(page: Page, url: string, button: string, expected = 200) {
  const waiting = page.waitForResponse((response: { url(): string; request(): { method(): string } }) => response.url() === origin + url && response.request().method() === "POST");
  await page.getByRole("button", { name: button, exact: true }).click();
  const response = await waiting; assert.equal(response.status(), expected); return response;
}
async function accelerateSaveDeadline(c: Context) {
  await c.addInitScript(() => {
    const original = AbortSignal.timeout.bind(AbortSignal), observed: number[] = [];
    Object.defineProperty(window, "__catalogueTimeouts", { value: observed });
    AbortSignal.timeout = (ms: number) => { observed.push(ms); return original(ms === 20000 ? 600 : ms); };
  });
}
test("taxonomy guards switching and navigation without warning for unchanged forms", async () => {
  const c = await context(), page = await c.newPage(); let discard = false, dialogs = 0;
  page.on("dialog", async (dialog: { accept(): Promise<void>; dismiss(): Promise<void> }) => { dialogs++; if (discard) await dialog.accept(); else await dialog.dismiss(); });
  try {
    await signIn(page); await page.goto(origin + "/admin/taxonomy");
    await page.getByLabel("Choose category", { exact: true }).selectOption(id(1));
    const category = page.getByRole("group", { name: "Edit category", exact: true }), name = category.getByLabel("Name", { exact: true });
    const originalName = await name.inputValue();
    await page.getByLabel("Choose category", { exact: true }).selectOption(id(2)); assert.equal(dialogs, 0);
    await page.getByLabel("Choose category", { exact: true }).selectOption(id(1)); await name.fill("Unsaved local category");
    await page.getByLabel("Choose category", { exact: true }).selectOption(id(2));
    assert.equal(await page.getByLabel("Choose category", { exact: true }).inputValue(), id(1)); assert.equal(await name.inputValue(), "Unsaved local category");
    await page.getByRole("link", { name: "Product catalogue", exact: true }).click(); assert.equal(page.url(), origin + "/admin/taxonomy");
    assert.equal(await name.inputValue(), "Unsaved local category");
    assert.equal(await page.evaluate(() => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; }), true);
    discard = true; await page.getByLabel("Choose category", { exact: true }).selectOption(id(2)); await page.getByLabel("Choose category", { exact: true }).selectOption(id(1));
    assert.equal(await name.inputValue(), originalName);
    await page.getByLabel("Choose collection", { exact: true }).selectOption(id(12));
    const collection = page.getByRole("group", { name: "Edit collection", exact: true }), collectionName = collection.getByLabel("Name", { exact: true });
    await collectionName.fill("Unsaved local collection"); discard = false; await page.getByLabel("Choose collection", { exact: true }).selectOption(id(11));
    assert.equal(await page.getByLabel("Choose collection", { exact: true }).inputValue(), id(12)); assert.equal(await collectionName.inputValue(), "Unsaved local collection");
    discard = true; await page.getByRole("button", { name: "Discard collection changes", exact: true }).click();
    await pause(30); assert.equal(await page.evaluate(() => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; }), false);
  } finally { await c.close(); }
});
test("taxonomy verified saves preserve the other dirty form and conflicting saves retain edits", async () => {
  const c = await context(), page = await c.newPage(); page.on("dialog", (dialog: { accept(): Promise<void> }) => dialog.accept());
  try {
    await signIn(page); await page.goto(origin + "/admin/taxonomy");
    await page.getByLabel("Choose category", { exact: true }).selectOption(id(1)); await page.getByLabel("Choose collection", { exact: true }).selectOption(id(12));
    const category = page.getByRole("group", { name: "Edit category", exact: true }), collection = page.getByRole("group", { name: "Edit collection", exact: true });
    await category.getByLabel("Description", { exact: true }).fill("Local verified category update."); await collection.getByLabel("Description", { exact: true }).fill("Keep this unsaved collection description.");
    await post(page, "/api/admin/catalogue/taxonomy", "Save category"); await page.getByRole("status").filter({ hasText: "Category saved." }).waitFor();
    assert.equal(await collection.getByLabel("Description", { exact: true }).inputValue(), "Keep this unsaved collection description.");
    assert.ok(await page.getByText("Unsaved collection changes.", { exact: true }).isVisible()); assert.equal(await page.getByText("Unsaved category changes.", { exact: true }).count(), 0);
    await fixture.data.query("UPDATE collections SET updated_at=clock_timestamp() WHERE id=$1", [id(12)]);
    await post(page, "/api/admin/catalogue/taxonomy", "Save collection", 409); await alert(page).waitFor();
    assert.match(await alert(page).innerText(), /changed|Reload/i); assert.ok(await page.getByRole("button", { name: "Save collection", exact: true }).isEnabled());
    assert.equal(await collection.getByLabel("Description", { exact: true }).inputValue(), "Keep this unsaved collection description.");
    await page.getByRole("button", { name: "Reload saved groupings", exact: true }).click(); await page.getByRole("status").filter({ hasText: "Saved categories and collections loaded." }).waitFor();
    await collection.getByLabel("Description", { exact: true }).fill("Local collection after explicit reload.");
    await post(page, "/api/admin/catalogue/taxonomy", "Save collection"); await page.getByRole("status").filter({ hasText: "Collection saved." }).waitFor();
    assert.equal(await page.getByText("Unsaved collection changes.", { exact: true }).count(), 0);
  } finally { await c.close(); }
});
test("taxonomy timeout after server commit is not retried and explicit reload recovers saved state", { timeout: 90000 }, async () => {
  const c = await context(); await accelerateSaveDeadline(c); const page = await c.newPage(); let attempts = 0, release = () => {};
  page.on("dialog", (dialog: { accept(): Promise<void> }) => dialog.accept()); const held = new Promise<void>((done) => { release = done; });
  try {
    await signIn(page); await page.goto(origin + "/admin/taxonomy"); await page.getByLabel("Choose category", { exact: true }).selectOption(id(2));
    const group = page.getByRole("group", { name: "Edit category", exact: true }); await group.getByLabel("Description", { exact: true }).fill("Local committed category, delayed reply.");
    await page.route("**/api/admin/catalogue/taxonomy", async (route: { request(): { method(): string }; fetch(): Promise<{ status(): number }>; fulfill(value: unknown): Promise<void>; continue(): Promise<void> }) => {
      if (route.request().method() !== "POST") { await route.continue(); return; } attempts++;
      const response = await route.fetch(); assert.equal(response.status(), 200); await held; try { await route.fulfill({ response }); } catch { /* The browser aborted the delayed response. */ }
    });
    await page.getByRole("button", { name: "Save category", exact: true }).click(); await alert(page).filter({ hasText: "outcome is uncertain" }).waitFor();
    assert.equal(attempts, 1); assert.ok(await page.getByRole("button", { name: "Save category", exact: true }).isDisabled()); assert.ok(await group.getByLabel("Name", { exact: true }).isEnabled());
    assert.ok(await page.evaluate(() => (window as unknown as { __catalogueTimeouts: number[] }).__catalogueTimeouts.includes(20000)));
    await page.getByRole("button", { name: "Reload saved groupings", exact: true }).click(); await page.getByRole("status").filter({ hasText: "Saved categories and collections loaded." }).waitFor();
    assert.equal(await group.getByLabel("Description", { exact: true }).inputValue(), "Local committed category, delayed reply.");
    assert.ok(await page.getByRole("button", { name: "Save category", exact: true }).isEnabled()); assert.equal(attempts, 1);
  } finally { release(); await c.close(); }
});
test("product prices identify and focus the invalid variant while exact EGP values persist", async () => {
  const c = await context(), page = await c.newPage();
  try {
    await signIn(page); await page.goto(origin + "/admin/products/" + id(102) + "/edit");
    const price = page.getByRole("group", { name: "Variant 2", exact: true }).getByLabel("Selling price (EGP)", { exact: true });
    await price.fill("12.345"); const response = await post(page, "/api/admin/catalogue/products/" + id(102) + "/save", "Save changes", 400);
    assert.ok((await response.json()).fieldErrors["product.variants.1.priceEGP"]); await alert(page).waitFor(); assert.match(await alert(page).innerText(), /Variant 2.*Selling price/);
    assert.equal(await price.getAttribute("aria-invalid"), "true"); assert.ok(await price.getAttribute("aria-describedby"));
    await page.waitForFunction(() => document.activeElement?.getAttribute("data-field-path") === "product.variants.1.priceEGP");
    assert.equal(await price.getAttribute("inputmode"), "decimal"); await price.fill("2650.07");
    await post(page, "/api/admin/catalogue/products/" + id(102) + "/save", "Save changes"); await page.reload();
    assert.equal(await price.inputValue(), "2650.07"); assert.notEqual(await price.getAttribute("aria-invalid"), "true");
    assert.equal((await fixture.data.query("SELECT amount_minor::text AS amount FROM product_prices WHERE variant_id=$1 AND is_active", [id(207)])).rows[0].amount, "265007");
  } finally { await c.close(); }
});
test("valid long SKUs and multiple-variant text fit required widths and names expose editing", async () => {
  const c = await context(), page = await c.newPage(), sku = "A".repeat(80);
  try {
    await fixture.data.query("UPDATE product_variants SET sku=$2,configuration_label=$3,metal_type=$4,metal_purity=$4,metal_color=$4 WHERE id=$1", [id(202), sku, "C".repeat(250), "M".repeat(160)]);
    await signIn(page);
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 }); await page.goto(origin + "/admin/products/" + id(102) + "/edit");
      assert.equal(await page.getByLabel("SKU", { exact: true }).first().inputValue(), sku);
      assert.deepEqual(await page.locator("main input,main select,main textarea,main fieldset,main button").evaluateAll((elements: HTMLElement[]) => elements.filter((element) => {
        const r = element.getBoundingClientRect(); return r.width > 0 && (r.x < -1 || r.right > innerWidth + 1);
      }).map((element) => ({ tag: element.tagName, label: element.getAttribute("aria-label") }))), [], "No clipped controls at " + width + "px");
      await page.getByRole("heading", { name: "Inventory & availability", exact: true }).scrollIntoViewIfNeeded(); await screenshot(page, "v3-admin-inventory-" + width);
    }
    await page.setViewportSize({ width: 320, height: 844 }); await page.goto(origin + "/admin/products");
    const link = page.getByRole("link", { name: "Edit product [DEVELOPMENT] repeatable-earrings", exact: true }); assert.ok(await link.count());
    assert.equal(await link.evaluate((element: HTMLElement) => { const r = element.getBoundingClientRect(); return r.x < innerWidth && r.right > 0; }), true);
    await link.click(); await page.waitForURL(origin + "/admin/products/" + id(102) + "/edit");
  } finally { await c.close(); }
});
test("new-product timeout after commit prevents repeated creation and offers catalogue inspection", { timeout: 90000 }, async () => {
  const c = await context(); await accelerateSaveDeadline(c); const page = await c.newPage(); let attempts = 0, release = () => {};
  const held = new Promise<void>((done) => { release = done; }); page.on("dialog", (dialog: { accept(): Promise<void> }) => dialog.accept());
  try {
    await signIn(page); await page.goto(origin + "/admin/products/new");
    await page.getByLabel("Product name", { exact: true }).fill("Local uncertain create fixture"); await page.getByLabel("URL slug", { exact: true }).fill("local-uncertain-create-fixture");
    await page.route("**/api/admin/catalogue/products", async (route: { fetch(): Promise<{ status(): number }>; fulfill(value: unknown): Promise<void> }) => { attempts++; const response = await route.fetch(); assert.equal(response.status(), 200); await held; try { await route.fulfill({ response }); } catch { /* No mutation retry follows the timeout. */ } });
    await page.getByRole("button", { name: "Create draft", exact: true }).click(); await alert(page).filter({ hasText: "outcome is uncertain" }).waitFor();
    assert.ok(await page.getByRole("button", { name: "Create draft", exact: true }).isDisabled()); assert.ok(await page.getByLabel("Product name", { exact: true }).isEnabled()); assert.equal(attempts, 1);
    assert.equal((await fixture.data.query("SELECT count(*)::int AS n FROM products WHERE slug='local-uncertain-create-fixture'")).rows[0].n, 1);
    await page.getByLabel("URL slug", { exact: true }).fill("different-unsent-local-slug");
    assert.match(await page.getByRole("link", { name: "Check product catalogue before creating another draft", exact: true }).getAttribute("href"), /q=local-uncertain-create-fixture$/);
    await page.getByRole("link", { name: "Check product catalogue before creating another draft", exact: true }).click(); await page.waitForURL(/\/admin\/products\?q=local-uncertain-create-fixture$/);
    assert.ok(await page.getByRole("link", { name: "Edit product Local uncertain create fixture", exact: true }).isVisible()); assert.equal(attempts, 1);
  } finally { release(); await c.close(); }
});
test("existing-product network uncertainty blocks mutations and reload recovers without retry", { timeout: 90000 }, async () => {
  const c = await context(), page = await c.newPage(); page.on("dialog", (dialog: { accept(): Promise<void> }) => dialog.accept()); let attempts = 0;
  try {
    await signIn(page); await page.goto(origin + "/admin/products/" + id(102) + "/edit");
    const oldName = await page.getByLabel("Product name", { exact: true }).inputValue(); await page.getByLabel("Product name", { exact: true }).fill("Local unsent network failure");
    await page.route("**/api/admin/catalogue/products/" + id(102) + "/save", async (route: { abort(reason: string): Promise<void> }) => { attempts++; await route.abort("connectionfailed"); });
    await page.getByRole("button", { name: "Save changes", exact: true }).click(); await alert(page).filter({ hasText: "outcome is uncertain" }).waitFor();
    for (const label of ["Save changes", "Unpublish", "Archive"]) assert.ok(await page.getByRole("button", { name: label, exact: true }).isDisabled());
    assert.ok(await page.getByLabel("Adjustment reason", { exact: true }).first().isDisabled()); assert.ok(await page.getByLabel("Photograph", { exact: true }).isDisabled()); assert.equal(attempts, 1);
    await page.getByRole("button", { name: "Reload saved product", exact: true }).click(); await page.getByRole("status").filter({ hasText: "Current saved product loaded." }).waitFor();
    assert.equal(await page.getByLabel("Product name", { exact: true }).inputValue(), oldName); assert.ok(await page.getByRole("button", { name: "Save changes", exact: true }).isEnabled()); assert.equal(attempts, 1);
  } finally { await c.close(); }
});

test("post-commit product authentication failures lock mutations until read-only recovery", async () => {
  for (const status of [401, 403, 404]) {
    const c = await context(), page = await c.newPage(); let attempts = 0, reads = 0;
    page.on("dialog", (dialog: { accept(): Promise<void> }) => dialog.accept());
    const endpoint = origin + "/api/admin/catalogue/products/" + id(102);
    try {
      await signIn(page); await page.goto(origin + "/admin/products/" + id(102) + "/edit");
      const description = "Local committed product with denied projection " + status;
      await page.getByLabel("Description", { exact: true }).fill(description);
      page.on("request", (request: { url(): string; method(): string }) => { if (request.url() === endpoint && request.method() === "GET") reads++; });
      await page.route(endpoint + "/save", async (route: { fetch(): Promise<{ status(): number }>; fulfill(value: unknown): Promise<void> }) => {
        attempts++; const committed = await route.fetch(); assert.equal(committed.status(), 200);
        await route.fulfill({ status, json: { message: "Local access recheck failed after the fixture commit." } });
      });
      await post(page, "/api/admin/catalogue/products/" + id(102) + "/save", "Save changes", status);
      await alert(page).filter({ hasText: "outcome is uncertain" }).waitFor();
      assert.equal((await fixture.data.query("SELECT description FROM products WHERE id=$1", [id(102)])).rows[0].description, description);
      for (const label of ["Save changes", "Unpublish", "Archive"]) assert.ok(await page.getByRole("button", { name: label, exact: true }).isDisabled());
      assert.ok(await page.getByLabel("Adjustment reason", { exact: true }).first().isDisabled());
      assert.ok(await page.getByLabel("Photograph", { exact: true }).isDisabled());
      assert.ok(await page.getByLabel("Product name", { exact: true }).isEnabled());
      await pause(100); assert.equal(attempts, 1);
      await page.getByRole("button", { name: "Reload saved product", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "Current saved product loaded." }).waitFor();
      assert.equal(await page.getByLabel("Description", { exact: true }).inputValue(), description);
      assert.ok(await page.getByRole("button", { name: "Save changes", exact: true }).isEnabled());
      assert.equal(reads, 1); assert.equal(attempts, 1);
    } finally { await c.close(); }
  }
});

test("post-commit taxonomy authentication failures require a successful read-only recovery and never retry", async () => {
  for (const status of [401, 403]) {
    const c = await context(), page = await c.newPage(); let attempts = 0, reads = 0, rejectReload = true;
    page.on("dialog", (dialog: { accept(): Promise<void> }) => dialog.accept());
    try {
      await signIn(page); await page.goto(origin + "/admin/taxonomy");
      await page.getByLabel("Choose category", { exact: true }).selectOption(id(3));
      const group = page.getByRole("group", { name: "Edit category", exact: true });
      const description = "Local committed category with denied projection " + status;
      await group.getByLabel("Description", { exact: true }).fill(description);
      await page.route(origin + "/api/admin/catalogue/taxonomy", async (route: { request(): { method(): string }; fetch(): Promise<{ status(): number }>; fulfill(value: unknown): Promise<void>; continue(): Promise<void> }) => {
        if (route.request().method() === "GET") {
          reads++; if (rejectReload) await route.fulfill({ status: 401, json: { message: "Local recovery authorization still unavailable." } }); else await route.continue();
          return;
        }
        attempts++; const committed = await route.fetch(); assert.equal(committed.status(), 200);
        await route.fulfill({ status, json: { message: "Local access recheck failed after the fixture commit." } });
      });
      await post(page, "/api/admin/catalogue/taxonomy", "Save category", status);
      await alert(page).filter({ hasText: "outcome is uncertain" }).waitFor();
      assert.equal((await fixture.data.query("SELECT description FROM categories WHERE id=$1", [id(3)])).rows[0].description, description);
      assert.ok(await page.getByRole("button", { name: "Save category", exact: true }).isDisabled());
      assert.ok(await page.getByRole("button", { name: "Create collection", exact: true }).isDisabled());
      assert.ok(await group.getByLabel("Description", { exact: true }).isEnabled()); assert.equal(attempts, 1);
      await page.getByRole("button", { name: "Reload saved groupings", exact: true }).click();
      await alert(page).filter({ hasText: "Saved groupings could not be reloaded" }).waitFor();
      assert.ok(await page.getByRole("button", { name: "Save category", exact: true }).isDisabled());
      assert.equal(await group.getByLabel("Description", { exact: true }).inputValue(), description); assert.equal(attempts, 1);
      rejectReload = false;
      await page.getByRole("button", { name: "Reload saved groupings", exact: true }).click();
      await page.getByRole("status").filter({ hasText: "Saved categories and collections loaded." }).waitFor();
      assert.equal(await group.getByLabel("Description", { exact: true }).inputValue(), description);
      assert.ok(await page.getByRole("button", { name: "Save category", exact: true }).isEnabled());
      assert.equal(reads, 2); assert.equal(attempts, 1);
    } finally { await c.close(); }
  }
});
