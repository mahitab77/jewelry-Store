import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import { adminBrowserHarness } from "./helpers/admin-browser.mts";
import { developmentId as id } from "../db/tools/seed.ts";
import type { PublicRequestInput } from "../src/lib/requests/types.ts";

// Browser plugin not available. Use the existing production Next/Playwright
// HTTPS harness and disposable PostgreSQL fixture; never a hosted environment.
// Flow: tracked request entry -> edit/navigation/recovery -> one honest receipt.
process.env.COMMERCE_MODE = "QUOTATION_ONLY";
const h = adminBrowserHarness(true, false, false, false, { requests: true });
const { origin, screenshot } = h;
let browser: ReturnType<typeof h.current>["browser"], fixture: ReturnType<typeof h.current>["fixture"];
type Page = Awaited<ReturnType<typeof browser.newPage>>;
beforeEach(() => { ({ browser, fixture } = h.current()); });
const syntheticMessage = "LOCAL TEST ONLY. Please discuss this synthetic design and its current availability.";
const customerEmail = () => `local-experience-${randomUUID().slice(0, 8)}@boutique.test`;
async function bounded<T>(promise: Promise<T>, message: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), 15000); })]); }
  finally { if (timer) clearTimeout(timer); }
}
async function context(width = 1440, withoutNavigationAPI = false) {
  const c = await browser.newContext({ ignoreHTTPSErrors: true, reducedMotion: "reduce", viewport: { width, height: 1000 } });
  c.setDefaultTimeout(15000); c.setDefaultNavigationTimeout(15000);
  if (withoutNavigationAPI) await c.addInitScript(() => Object.defineProperty(window, "navigation", { configurable: true, value: undefined }));
  return c;
}
async function details(page: Page) {
  await page.getByLabel("Your name (required)", { exact: true }).fill("Local Experience Fixture");
  await page.getByRole("textbox", { name: /^Email/ }).fill(customerEmail());
  await page.locator('textarea[name="message"]').fill(syntheticMessage);
}
function requestResponse(page: Page) {
  return page.waitForResponse((response: { url(): string; request(): { method(): string } }) => response.url() === origin + "/api/requests" && response.request().method() === "POST");
}
async function send(page: Page, status = 200, retry = false) {
  const waiting = requestResponse(page);
  await page.getByRole("button", { name: retry ? "Retry this same request" : "Send request", exact: true }).click();
  const response = await waiting; assert.equal(response.status(), status);
  if (status === 200) await page.getByRole("heading", { name: "Your request has been received.", exact: true }).waitFor();
  else await page.locator("main").getByRole("alert").waitFor();
  return response;
}
async function total(reference: string) {
  return Number((await fixture.data.query("SELECT (SELECT count(*) FROM product_enquiries WHERE id=$1)+(SELECT count(*) FROM bespoke_requests WHERE id=$1)+(SELECT count(*) FROM appointment_requests WHERE id=$1) AS count", [reference])).rows[0].count);
}
async function dialogAction(page: Page, accept: boolean, action: () => Promise<unknown>, pattern = /request|details|receipt/i) {
  const observed = page.waitForEvent("dialog");
  const operation = action();
  const dialog = await observed; assert.match(dialog.message(), pattern);
  if (accept) await dialog.accept(); else await dialog.dismiss();
  await operation;
}

test("unowned campaign parameters reach all five guest request journeys with the selected configuration", { timeout: 120000 }, async () => {
  for (const journey of ["QUOTATION", "MODIFICATION", "BESPOKE", "ZOOM", "BOUTIQUE"] as const) {
    const c = await context();
    try {
      const page = await c.newPage(), errors: string[] = []; page.on("pageerror", () => errors.push("Page runtime error"));
      const product = journey === "QUOTATION" || journey === "MODIFICATION";
      const path = journey === "ZOOM" || journey === "BOUTIQUE" ? "/appointment?intent=CONSULTATION" : `/contact?intent=${journey}`;
      await page.goto(origin + path + (product ? `&product=dev-repeatable-earrings&variant=${id(207)}` : "") + "&utm_source=local&utm_source=repeated&utm_campaign=fixture&gclid=local-only");
      await page.getByRole("heading", { name: "Begin a conversation.", exact: true }).waitFor();
      assert.equal(await page.getByLabel("What would you like to do?", { exact: true }).inputValue(), product ? journey : journey === "BESPOKE" ? "BESPOKE" : "CONSULTATION");
      if (product) assert.equal(await page.getByLabel("Selected configuration", { exact: true }).inputValue(), id(207));
      if (journey === "ZOOM" || journey === "BOUTIQUE") await page.getByLabel("Consultation preference", { exact: true }).selectOption(journey);
      await details(page); const receipt = await (await send(page)).json();
      assert.deepEqual(Object.keys(receipt).sort(), ["message", "reference"]); assert.equal(await total(receipt.reference), 1);
      if (product) {
        const table = journey === "QUOTATION" ? "product_enquiries" : "bespoke_requests";
        assert.deepEqual((await fixture.data.query(`SELECT product_id,variant_id FROM ${table} WHERE id=$1`, [receipt.reference])).rows[0], { product_id: id(102), variant_id: id(207) });
      }
      assert.deepEqual(errors, []);
    } finally { await c.close(); }
  }
});

test("owned empty, duplicate and invalid parameters are rejected even alongside tracking", { timeout: 90000 }, async () => {
  const c = await context();
  try {
    const page = await c.newPage();
    for (const path of [
      "/contact?intent=BESPOKE&intent=BESPOKE", "/contact?intent=UNKNOWN", "/contact?intent=", "/contact?product=", "/contact?variant=",
      "/contact?product=dev-unique-ring&product=dev-unique-ring", `/contact?product=dev-unique-ring&variant=${id(201)}&variant=${id(201)}`,
      `/contact?intent=QUOTATION&product=dev-unique-ring&variant=${id(207)}`, "/appointment?intent=UNKNOWN", "/appointment?intent=CONSULTATION&intent=CONSULTATION",
    ]) {
      await page.goto(origin + path + "&utm_source=local&gclid=fixture");
      await page.locator("main").getByRole("alert").waitFor();
      assert.equal(await page.getByRole("button", { name: "Send request", exact: true }).count(), 0, path);
    }
  } finally { await c.close(); }
});

for (const withoutNavigationAPI of [false, true]) test(`dirty draft survives canceled and permitted Back/Forward${withoutNavigationAPI ? " without the Navigation API" : ""}`, { timeout: 90000 }, async () => {
  const c = await context(1440, withoutNavigationAPI);
  try {
    const page = await c.newPage(); await page.goto(origin + "/contact?intent=BESPOKE"); await details(page);
    await dialogAction(page, false, () => page.getByRole("link", { name: "Private Appointments", exact: true }).click()); assert.equal(page.url(), origin + "/contact?intent=BESPOKE");
    await dialogAction(page, true, () => page.getByRole("link", { name: "Private Appointments", exact: true }).click()); await page.waitForURL(origin + "/appointment"); await details(page);
    const email = await page.getByRole("textbox", { name: /^Email/ }).inputValue();
    const entries = await page.evaluate(() => history.length);
    assert.equal(await page.evaluate((email: string) => [location.href, JSON.stringify(history.state), JSON.stringify(localStorage), JSON.stringify(sessionStorage)].some(value => value.includes(email) || value.includes("Local Experience Fixture") || value.includes("LOCAL TEST ONLY.")), email), false, "Request details must stay out of URLs, history state and browser storage.");
    await page.evaluate(() => history.replaceState({ ...history.state, localFixture: "preserve-external-state" }, ""));
    // Browser-initiated traversals must cancel before Next replaces the form.
    for (let attempt = 0; attempt < 3; attempt++) {
      await dialogAction(page, false, () => page.evaluate(() => history.back()));
      await page.waitForURL(origin + "/appointment"); assert.equal(await page.locator('textarea[name="message"]').inputValue(), syntheticMessage);
    }
    assert.equal(await page.evaluate(() => history.state.localFixture), "preserve-external-state");
    await dialogAction(page, true, () => page.evaluate(() => history.back())); await page.waitForURL(origin + "/contact?intent=BESPOKE");
    for (let attempt = 0; attempt < 2; attempt++) { await dialogAction(page, false, () => page.evaluate(() => history.forward())); await page.waitForURL(origin + "/contact?intent=BESPOKE"); }
    await dialogAction(page, true, () => page.evaluate(() => history.forward())); await page.waitForURL(origin + "/appointment");
    assert.equal(await page.getByRole("textbox", { name: /^Email/ }).inputValue(), email); assert.equal(await page.locator('textarea[name="message"]').inputValue(), syntheticMessage);
    await dialogAction(page, false, () => page.getByRole("button", { name: "Discard request details", exact: true }).click());
    assert.equal(await page.locator('textarea[name="message"]').inputValue(), syntheticMessage);
    await dialogAction(page, true, () => page.getByRole("button", { name: "Discard request details", exact: true }).click());
    assert.equal(await page.getByLabel("Your name (required)", { exact: true }).inputValue(), "");
    assert.equal(await page.locator('textarea[name="message"]').inputValue(), "");
    await page.evaluate(() => history.back()); await page.waitForURL(origin + "/contact?intent=BESPOKE");
    await dialogAction(page, true, () => page.getByRole("button", { name: "Discard request details", exact: true }).click());
    await page.evaluate(() => history.forward()); await page.waitForURL(origin + "/appointment");
    assert.equal(await page.locator('textarea[name="message"]').inputValue(), "");
    assert.ok(await page.evaluate(() => history.state?.__NA && history.state?.__PRIVATE_NEXTJS_INTERNALS_TREE), "Next's router history state must survive cancellation and restoration.");
    assert.equal(await page.evaluate(() => history.length), entries, "Canceling history must not add synthetic entries.");
  } finally { await c.close(); }
});

test("native hash entries and Next null replacement retain indexed fallback history without adding entries", { timeout: 90000 }, async () => {
  const c = await context(1440, true);
  try {
    const page = await c.newPage(); await page.goto(origin + "/contact?intent=BESPOKE"); await details(page);
    const email = await page.getByRole("textbox", { name: /^Email/ }).inputValue();
    const skip = page.getByRole("link", { name: "Skip to content", exact: true }); await skip.focus(); await skip.click();
    await page.waitForURL(origin + "/contact?intent=BESPOKE#catalogue-content");
    await page.waitForFunction(() => history.state?.__NA === true && history.state?.__PRIVATE_NEXTJS_INTERNALS_TREE && history.state?.__lpRequestHistory);
    await page.evaluate(() => history.replaceState(null, "", location.href));
    assert.ok(await page.evaluate(() => history.state?.__NA === true && history.state?.__PRIVATE_NEXTJS_INTERNALS_TREE && history.state?.__lpRequestHistory), "Next's delegated null replacement must retain complete indexed router state.");
    await dialogAction(page, true, () => page.getByRole("link", { name: "Private Appointments", exact: true }).click()); await page.waitForURL(origin + "/appointment"); await details(page);
    const entries = await page.evaluate(() => history.length);
    for (let attempt = 0; attempt < 3; attempt++) { await dialogAction(page, false, () => page.evaluate(() => history.back())); await page.waitForURL(origin + "/appointment"); }
    await dialogAction(page, true, () => page.evaluate(() => history.back())); await page.waitForURL(origin + "/contact?intent=BESPOKE#catalogue-content");
    assert.equal(await page.getByRole("textbox", { name: /^Email/ }).inputValue(), email);
    await page.evaluate(() => history.back()); await page.waitForURL(origin + "/contact?intent=BESPOKE");
    await page.evaluate(() => history.forward()); await page.waitForURL(origin + "/contact?intent=BESPOKE#catalogue-content");
    assert.equal(await page.locator('textarea[name="message"]').inputValue(), syntheticMessage);
    await dialogAction(page, true, () => page.evaluate(() => history.forward())); await page.waitForURL(origin + "/appointment");
    assert.equal(await page.evaluate(() => history.length), entries);
  } finally { await c.close(); }
});

test("missing name and missing Zoom email stay editable and corrections reuse the same UUID", { timeout: 90000 }, async () => {
  const c = await context(); const bodies: PublicRequestInput[] = [];
  try {
    const page = await c.newPage(); await page.goto(origin + "/appointment"); await details(page);
    page.on("request", (request: { url(): string; method(): string; postDataJSON(): PublicRequestInput }) => { if (request.url() === origin + "/api/requests" && request.method() === "POST") bodies.push(request.postDataJSON()); });
    await page.getByLabel("Your name (required)", { exact: true }).fill("");
    let response = await send(page, 400), result = await response.json(); assert.equal(result.outcome, "NOT_CREATED");
    await page.waitForFunction(() => document.activeElement?.getAttribute("name") === "name");
    assert.equal(await page.getByLabel("Your name (required)", { exact: true }).isEnabled(), true);
    await page.getByLabel("Your name (required)", { exact: true }).fill("Local Experience Fixture"); await page.getByRole("textbox", { name: /^Email/ }).fill(""); await page.getByLabel("Telephone", { exact: true }).fill("+201001234567");
    response = await send(page, 400); result = await response.json(); assert.equal(result.outcome, "NOT_CREATED");
    await page.waitForFunction(() => document.activeElement?.getAttribute("name") === "email"); assert.equal(await page.getByRole("textbox", { name: /^Email/ }).isEnabled(), true);
    assert.equal(await page.locator('textarea[name="message"]').inputValue(), syntheticMessage);
    await page.getByRole("textbox", { name: /^Email/ }).fill(customerEmail());
    const receipt = await (await send(page)).json(); assert.equal(new Set(bodies.map(body => body.submissionId)).size, 1); assert.equal(receipt.reference, bodies[0].submissionId); assert.equal(await total(receipt.reference), 1);
  } finally { await c.close(); }
});

test("uncertain absent request recovers through a real 409 proof, retains text and fences a late original", { timeout: 90000 }, async () => {
  const c = await context(); const bodies: PublicRequestInput[] = [];
  try {
    const page = await c.newPage(); await page.goto(origin + `/contact?intent=QUOTATION&product=dev-unique-ring&variant=${id(201)}`); await details(page);
    const email = await page.getByRole("textbox", { name: /^Email/ }).inputValue();
    await page.route(origin + "/api/requests", async (route: { request(): { postDataJSON(): PublicRequestInput }; fulfill(value: unknown): Promise<void>; continue(): Promise<void> }) => {
      bodies.push(route.request().postDataJSON());
      if (bodies.length === 1) await route.fulfill({ status: 503, json: { message: "LOCAL TEST ONLY: transport uncertainty before delivery.", outcome: "UNKNOWN" } }); else await route.continue();
    });
    await send(page, 503); assert.equal(await page.getByLabel("Your name (required)", { exact: true }).isDisabled(), true); assert.equal(await total(bodies[0].submissionId), 0);
    await fixture.data.query("UPDATE products SET status='DRAFT' WHERE id=$1", [id(101)]);
    const response = await send(page, 409, true), proof = await response.json(); assert.equal(proof.outcome, "NOT_CREATED"); assert.equal(proof.submissionId, bodies[0].submissionId); assert.deepEqual(bodies[1], bodies[0]);
    await page.waitForFunction(() => !(document.querySelector('input[name="name"]') as HTMLInputElement)?.disabled && !(document.querySelector("fieldset") as HTMLFieldSetElement)?.disabled);
    assert.equal(await page.getByLabel("Your name (required)", { exact: true }).inputValue(), "Local Experience Fixture"); assert.equal(await page.getByRole("textbox", { name: /^Email/ }).inputValue(), email); assert.equal(await page.locator('textarea[name="message"]').inputValue(), syntheticMessage);
    assert.match(await page.locator("main").getByRole("alert").innerText(), /No request was created/); assert.equal(await page.getByRole("button", { name: "Retry this same request", exact: true }).count(), 0);
    await page.getByLabel("What would you like to do?", { exact: true }).selectOption("BESPOKE");
    await page.locator('textarea[name="message"]').fill(syntheticMessage + " Corrected to a new design discussion.");
    // Permit the original again so the same UUID is the only duplicate fence.
    await fixture.data.query("UPDATE products SET status='PUBLISHED' WHERE id=$1", [id(101)]);
    const receipt = await (await send(page)).json(); assert.equal(receipt.reference, bodies[0].submissionId); assert.equal(bodies[2].submissionId, bodies[0].submissionId);
    const lateOriginal = await c.request.post(origin + "/api/requests", { headers: { Origin: origin }, data: bodies[0] }); assert.equal(lateOriginal.status(), 409); assert.equal((await lateOriginal.json()).outcome, "CONFLICT");
    assert.equal(await total(receipt.reference), 1); assert.equal((await fixture.data.query("SELECT contact_email,message FROM bespoke_requests WHERE id=$1", [receipt.reference])).rows[0].contact_email, email);
  } finally { await fixture.data.query("UPDATE products SET status='PUBLISHED' WHERE id=$1", [id(101)]); await c.close(); }
});

test("uncertain committed request keeps its frozen UUID across history and every ambiguous retry", { timeout: 90000 }, async () => {
  const c = await context(); const bodies: PublicRequestInput[] = [];
  try {
    const page = await c.newPage(); await page.goto(origin + "/appointment"); await page.getByRole("link", { name: "Contact", exact: true }).first().click(); await page.waitForURL(origin + "/contact"); await details(page);
    await page.route(origin + "/api/requests", async (route: { request(): { postDataJSON(): PublicRequestInput }; fetch(): Promise<{ status(): number }>; fulfill(value: unknown): Promise<void>; continue(): Promise<void> }) => {
      bodies.push(route.request().postDataJSON());
      if (bodies.length === 1) { assert.equal((await route.fetch()).status(), 200); await route.fulfill({ status: 503, json: { message: "LOCAL TEST ONLY: lost receipt after commit.", outcome: "UNKNOWN" } }); }
      else if (bodies.length === 2) await route.fulfill({ status: 400, json: { message: "LOCAL TEST ONLY: unproven validation error.", fieldErrors: { name: "Do not unlock." }, outcome: "UNKNOWN" } });
      else if (bodies.length === 3) await route.fulfill({ status: 409, json: { message: "LOCAL TEST ONLY: key conflict.", outcome: "CONFLICT" } });
      else if (bodies.length === 4) await route.fulfill({ status: 429, json: { message: "LOCAL TEST ONLY: throttled.", outcome: "UNKNOWN" } });
      else if (bodies.length === 5) await route.fulfill({ status: 403, json: { message: "LOCAL TEST ONLY: origin unverified.", outcome: "UNKNOWN" } });
      else if (bodies.length === 6) await route.fulfill({ status: 503, contentType: "application/json", body: "LOCAL TEST ONLY: incomplete JSON receipt" });
      else if (bodies.length === 7) await route.fulfill({ status: 409, json: { message: "LOCAL TEST ONLY: proof for another reference.", outcome: "NOT_CREATED", submissionId: randomUUID() } });
      else await route.continue();
    });
    await send(page, 503); await dialogAction(page, false, () => page.evaluate(() => history.back()), /receipt|reference/i); await page.waitForURL(origin + "/contact");
    await dialogAction(page, true, () => page.evaluate(() => history.back()), /receipt|reference/i); await page.waitForURL(origin + "/appointment");
    await page.evaluate(() => history.forward()); await page.waitForURL(origin + "/contact");
    assert.equal(await page.getByLabel("Your name (required)", { exact: true }).isDisabled(), true);
    for (const status of [400, 409, 429, 403, 503, 409]) { await send(page, status, true); assert.equal(await page.getByLabel("Your name (required)", { exact: true }).isDisabled(), true); }
    const receipt = await (await send(page, 200, true)).json(); for (const body of bodies) assert.deepEqual(body, bodies[0]); assert.equal(await total(receipt.reference), 1);
    await page.getByRole("link", { name: "Explore the collections", exact: true }).first().click(); await page.waitForURL(origin + "/collections"); await page.evaluate(() => history.back()); await page.waitForURL(origin + "/contact");
    await page.getByRole("heading", { name: "Your request has been received.", exact: true }).waitFor(); assert.equal(await page.getByRole("button", { name: "Send request", exact: true }).count(), 0);
  } finally { await c.close(); }
});

test("explicit pending discard warns and a late committed receipt cannot resurrect the abandoned draft", { timeout: 60000 }, async () => {
  const c = await context(); let release!: () => void, reached!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { reached = resolve; });
  let original: PublicRequestInput | undefined;
  try {
    const page = await c.newPage(); await page.goto(origin + "/contact?intent=BESPOKE"); await details(page);
    await page.route(origin + "/api/requests", async (route: { request(): { postDataJSON(): PublicRequestInput }; fetch(): Promise<{ status(): number }>; fulfill(value: unknown): Promise<void> }) => {
      original = route.request().postDataJSON(); const response = await route.fetch(); assert.equal(response.status(), 200); reached(); await held; await route.fulfill({ response });
    });
    const receipt = requestResponse(page); await page.getByRole("button", { name: "Send request", exact: true }).click(); await bounded(ready, "The real request did not reach its deferred committed receipt.");
    await dialogAction(page, false, () => page.getByRole("button", { name: "Discard request details", exact: true }).click(), /may already have been received.*does not cancel.*duplicate/i);
    assert.equal(await page.getByLabel("Your name (required)", { exact: true }).isDisabled(), true);
    await dialogAction(page, true, () => page.getByRole("button", { name: "Discard request details", exact: true }).click(), /may already have been received.*does not cancel.*duplicate/i);
    release(); await receipt;
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    assert.equal(await page.getByLabel("Your name (required)", { exact: true }).isEnabled(), true); assert.equal(await page.getByLabel("Your name (required)", { exact: true }).inputValue(), "");
    assert.equal(await page.locator('textarea[name="message"]').inputValue(), ""); assert.equal(await page.getByRole("heading", { name: "Your request has been received.", exact: true }).count(), 0); assert.equal(await page.getByRole("button", { name: "Retry this same request", exact: true }).count(), 0);
    assert.ok(original); assert.equal(await total(original.submissionId), 1, "Discard abandons local recovery; it cannot cancel a committed request.");
  } finally { release(); await c.close(); }
});

test("receipt heading receives focus and stays visible at all required widths", { timeout: 120000 }, async () => {
  for (const width of [320, 768, 1024, 1440]) {
    const c = await context(width);
    try {
      const page = await c.newPage(), errors: string[] = []; page.on("pageerror", () => errors.push("Page runtime error"));
      await page.goto(origin + "/appointment?utm_source=local-receipt"); await details(page); await send(page);
      await page.waitForFunction(() => document.activeElement?.id === "request-received");
      const position = await page.evaluate(() => { const heading = document.getElementById("request-received")!; const box = heading.getBoundingClientRect(); return { top: box.top, bottom: box.bottom, width: document.documentElement.scrollWidth, viewport: innerWidth, height: innerHeight, tabIndex: heading.tabIndex }; });
      assert.equal(position.tabIndex, -1); assert.ok(position.top >= 0 && position.bottom <= position.height, `Receipt heading visible at ${width}px`); assert.ok(position.width <= position.viewport, `Receipt fits ${width}px`);
      assert.match(await page.locator("main").innerText(), /No order, final quotation or appointment has been confirmed/); assert.deepEqual(errors, []); await screenshot(page, `request-receipt-${width}`);
    } finally { await c.close(); }
  }
});
