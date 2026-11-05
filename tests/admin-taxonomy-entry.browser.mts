import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { adminBrowserHarness } from "./helpers/admin-browser.mts";

const harness = adminBrowserHarness(true, false, false, false, { seedCatalogue: false });
const { origin, signIn, screenshot } = harness;
let browser: ReturnType<typeof harness.current>["browser"], fixture: ReturnType<typeof harness.current>["fixture"];
type Page = Awaited<ReturnType<typeof browser.newPage>>;
type Kind = "category" | "collection";
beforeEach(() => { ({ browser, fixture } = harness.current()); });
const section = (page: Page, kind: Kind) => page.getByRole("region", { name: kind === "category" ? "Categories" : "Collections", exact: true });
const editor = (page: Page, kind: Kind) => section(page, kind).getByRole("group");
async function save(page: Page, kind: Kind, creating = false, expected = 200) {
  const waiting = page.waitForResponse((response: { url(): string; request(): { method(): string } }) => response.url() === origin + "/api/admin/catalogue/taxonomy" && response.request().method() === "POST");
  await page.getByRole("button", { name: `${creating ? "Create" : "Save"} ${kind}`, exact: true }).click();
  assert.equal((await waiting).status(), expected);
  if (expected === 200) await page.getByRole("status").filter({ hasText: kind === "category" ? "Category saved." : "Collection saved." }).waitFor();
  else await page.locator("main").getByRole("alert").waitFor();
}

test("name-only taxonomy forms create visible categories and draft collections with server-generated URLs", async () => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, reducedMotion: "reduce" });
  try {
    const page = await context.newPage();
    await signIn(page, "CATALOGUE_MANAGER"); await page.goto(origin + "/admin/taxonomy");
    for (const kind of ["category", "collection"] as const) {
      const group = editor(page, kind);
      assert.equal(await group.locator("input:visible,textarea:visible,select:visible").count(), 1);
      assert.equal(await group.getByLabel("URL slug", { exact: true }).isVisible(), false);
    }
    await editor(page, "category").getByLabel("Name", { exact: true }).fill("Local Boutique Rings!");
    await save(page, "category", true);
    const actual = (await fixture.data.query("SELECT name,slug,description,parent_id,display_order,is_visible FROM categories WHERE name=$1", ["Local Boutique Rings!"])).rows[0];
    assert.deepEqual(actual, { name: "Local Boutique Rings!", slug: "local-boutique-rings", description: null, parent_id: null, display_order: 0, is_visible: true });
    await editor(page, "collection").getByLabel("Name", { exact: true }).fill("Local Signature Collection!");
    await save(page, "collection", true);
    const collection = (await fixture.data.query("SELECT slug,status,published_at,display_order FROM collections WHERE name=$1", ["Local Signature Collection!"])).rows[0];
    assert.deepEqual(collection, { slug: "local-signature-collection", status: "DRAFT", published_at: null, display_order: 0 });
    await editor(page, "category").getByLabel("Name", { exact: true }).fill("Renamed Local Boutique Rings");
    await save(page, "category");
    assert.equal((await fixture.data.query("SELECT slug FROM categories WHERE name=$1", ["Renamed Local Boutique Rings"])).rows[0].slug, actual.slug);
    await page.reload();
    await page.getByLabel("Choose category", { exact: true }).selectOption({ label: "Renamed Local Boutique Rings" });
    const category = editor(page, "category");
    await category.locator("summary").click();
    assert.equal(await category.getByLabel("URL slug", { exact: true }).inputValue(), actual.slug);
    assert.equal(await category.getByLabel("URL slug", { exact: true }).getAttribute("readonly"), "");
  } finally { await context.close(); }
});

test("advanced taxonomy values survive collapsing, saving, reload and independent form edits", async () => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, reducedMotion: "reduce" });
  try {
    const page = await context.newPage(); page.on("dialog", (dialog: { accept(): Promise<void> }) => dialog.accept());
    await signIn(page, "CATALOGUE_MANAGER"); await page.goto(origin + "/admin/taxonomy");
    const category = editor(page, "category"), collection = editor(page, "collection");
    await category.getByLabel("Name", { exact: true }).fill("Local Advanced Category");
    await category.locator("summary").click();
    await category.getByLabel("URL slug", { exact: true }).fill("local-manual-category-url");
    await category.getByLabel("Description", { exact: true }).fill("Local category editorial description.");
    await category.getByLabel("Display order", { exact: true }).fill("17");
    await category.getByLabel("Visible category", { exact: true }).uncheck();
    await category.locator("summary").click();
    await collection.getByLabel("Name", { exact: true }).fill("Local Advanced Collection");
    await collection.locator("summary").click();
    await collection.getByLabel("Description", { exact: true }).fill("Keep this independent unsaved collection description.");
    await collection.locator("summary").click();
    await save(page, "category", true);
    await collection.locator("summary").click();
    assert.equal(await collection.getByLabel("Description", { exact: true }).inputValue(), "Keep this independent unsaved collection description.");
    await collection.getByLabel("URL slug", { exact: true }).fill("local-manual-collection-url");
    await collection.getByLabel("Display order", { exact: true }).fill("19");
    await collection.getByLabel("Collection status", { exact: true }).selectOption("PUBLISHED");
    await save(page, "collection", true);
    assert.equal(await collection.getByLabel("URL slug", { exact: true }).getAttribute("readonly"), "");
    await page.reload();
    await page.getByLabel("Choose category", { exact: true }).selectOption({ label: "Local Advanced Category (hidden)" });
    await page.getByLabel("Choose collection", { exact: true }).selectOption({ label: "Local Advanced Collection (published)" });
    await category.locator("summary").click(); await collection.locator("summary").click();
    assert.equal(await category.getByLabel("Description", { exact: true }).inputValue(), "Local category editorial description.");
    assert.equal(await category.getByLabel("Display order", { exact: true }).inputValue(), "17");
    assert.equal(await category.getByLabel("Visible category", { exact: true }).isChecked(), false);
    assert.equal(await collection.getByLabel("Display order", { exact: true }).inputValue(), "19");
    assert.equal(await collection.getByLabel("Collection status", { exact: true }).inputValue(), "PUBLISHED");
    assert.equal(await collection.getByLabel("Description", { exact: true }).inputValue(), "Keep this independent unsaved collection description.");
  } finally { await context.close(); }
});

test("invalid collapsed taxonomy fields expand and focus without losing input; responsive sections remain unclipped", async () => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, reducedMotion: "reduce" });
  try {
    const page = await context.newPage(); page.on("dialog", (dialog: { accept(): Promise<void> }) => dialog.accept());
    await signIn(page, "CATALOGUE_MANAGER"); await page.goto(origin + "/admin/taxonomy");
    const category = editor(page, "category");
    await category.getByLabel("Name", { exact: true }).fill("Local Invalid Advanced Category");
    await category.locator("summary").click(); await category.getByLabel("Display order", { exact: true }).fill("-1"); await category.locator("summary").click();
    await page.getByRole("button", { name: "Create category", exact: true }).click();
    await page.locator("main").getByRole("alert").waitFor();
    await page.waitForFunction(() => document.activeElement?.id === "taxonomy-category-displayOrder");
    assert.equal(await category.locator("details").getAttribute("open"), "");
    assert.equal(await category.getByLabel("Display order", { exact: true }).getAttribute("aria-invalid"), "true");
    assert.equal(await category.getByLabel("Name", { exact: true }).inputValue(), "Local Invalid Advanced Category");
    assert.equal((await fixture.data.query("SELECT id FROM categories WHERE name=$1", ["Local Invalid Advanced Category"])).rowCount, 0);
    await category.getByLabel("Display order", { exact: true }).fill("0");
    // This parent is hidden, so the server must reject a visible child and the
    // collapsed parent control must be revealed rather than bypassing the rule.
    const parent = await context.request.post(origin + "/api/admin/catalogue/taxonomy", { headers: { Origin: origin }, data: { kind: "category", name: "Local Hidden Parent", visible: false } });
    assert.equal(parent.status(), 200); const parentId = (await parent.json()).id as string;
    await page.getByRole("button", { name: "Reload saved groupings", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Saved categories and collections loaded." }).waitFor();
    await category.getByLabel("Name", { exact: true }).fill("Local Visible Child");
    await category.getByLabel("Parent category", { exact: true }).selectOption(parentId);
    await category.locator("summary").click();
    await save(page, "category", true, 400);
    await page.waitForFunction(() => document.activeElement?.id === "taxonomy-category-parentId");
    assert.equal(await category.getByLabel("Parent category", { exact: true }).inputValue(), parentId);
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Taxonomy must fit ${width}px.`);
      assert.ok(await section(page, "category").getByRole("heading", { name: "Categories", exact: true }).isVisible());
      assert.ok(await section(page, "collection").getByRole("heading", { name: "Collections", exact: true }).isVisible());
      await screenshot(page, `taxonomy-entry-${width}`);
    }
  } finally { await context.close(); }
});

test("an uncertain name-only create reconciles a collision-suffixed slug through one read without retry", { timeout: 90000 }, async () => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, reducedMotion: "reduce" });
  await context.addInitScript(() => { const original = AbortSignal.timeout.bind(AbortSignal); AbortSignal.timeout = (ms: number) => original(ms === 20000 ? 600 : ms); });
  let release = () => {}, attempts = 0;
  const held = new Promise<void>((done) => { release = done; });
  try {
    const page = await context.newPage(); page.on("dialog", (dialog: { accept(): Promise<void> }) => dialog.accept());
    await signIn(page, "CATALOGUE_MANAGER");
    const first = await context.request.post(origin + "/api/admin/catalogue/taxonomy", { headers: { Origin: origin }, data: { kind: "category", name: "Local Recovery Collision" } });
    assert.equal(first.status(), 200);
    await page.goto(origin + "/admin/taxonomy");
    await editor(page, "category").getByLabel("Name", { exact: true }).fill("Local Recovery Collision");
    await page.route(origin + "/api/admin/catalogue/taxonomy", async (route: { request(): { method(): string }; fetch(): Promise<{ status(): number }>; continue(): Promise<void>; fulfill(value: unknown): Promise<void> }) => {
      if (route.request().method() !== "POST") { await route.continue(); return; }
      attempts++; const response = await route.fetch(); assert.equal(response.status(), 200); await held;
      try { await route.fulfill({ response }); } catch { /* The aborted response is deliberately uncertain. */ }
    });
    await page.getByRole("button", { name: "Create category", exact: true }).click();
    await page.locator("main").getByRole("alert").filter({ hasText: "outcome is uncertain" }).waitFor();
    assert.equal(attempts, 1); assert.equal(await page.getByRole("button", { name: "Create category", exact: true }).isDisabled(), true);
    await editor(page, "category").getByLabel("Name", { exact: true }).fill("A later local edit must not change recovery identity");
    await page.getByRole("button", { name: "Reload saved groupings", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Saved categories and collections loaded." }).waitFor();
    const category = editor(page, "category");
    assert.equal(await category.getByLabel("Name", { exact: true }).inputValue(), "Local Recovery Collision");
    assert.equal(await category.getByLabel("URL slug", { exact: true }).inputValue(), "local-recovery-collision-2");
    assert.equal(attempts, 1); assert.equal(await page.getByRole("button", { name: "Save category", exact: true }).isEnabled(), true);
    assert.equal((await fixture.data.query("SELECT id FROM categories WHERE name=$1", ["Local Recovery Collision"])).rowCount, 2);
  } finally { release(); await context.close(); }
});
