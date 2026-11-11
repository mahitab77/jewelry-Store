import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import { adminBrowserHarness } from "./helpers/admin-browser.mts";
import { developmentId as id } from "../db/tools/seed.ts";
import type { PublicRequestInput, RequestKind } from "../src/lib/requests/types.ts";

process.env.COMMERCE_MODE = "QUOTATION_ONLY";
const h = adminBrowserHarness(true,false,false,false,{ requests: true });
const { origin, signIn, screenshot } = h;
let browser: ReturnType<typeof h.current>["browser"], fixture: ReturnType<typeof h.current>["fixture"];
type Page = Awaited<ReturnType<typeof browser.newPage>>;
type Context = Awaited<ReturnType<typeof browser.newContext>>;
beforeEach(() => { ({ browser,fixture } = h.current()); });
const token = () => randomUUID().slice(0,8);
async function context(width = 1440): Promise<Context> {
  const c = await browser.newContext({ ignoreHTTPSErrors: true, reducedMotion: "reduce", viewport: { width, height: 1000 }, timezoneId: "America/Los_Angeles" });
  await h.customerContext(c); c.setDefaultTimeout(15000); c.setDefaultNavigationTimeout(15000); return c;
}
async function details(page: Page, value = "LOCAL TEST ONLY. Please discuss this synthetic request with the boutique.") {
  await page.getByLabel("Your name (required)",{ exact: true }).fill("Local Request Fixture");
  assert.equal(await page.getByRole("textbox",{ name: /^Email/ }).inputValue(), fixture.customerEmail);
  await page.locator('textarea[name="message"]').fill(value);
}
async function send(page: Page, expected = 200) {
  const waiting = page.waitForResponse((response: { url(): string; request(): { method(): string } }) => response.url() === origin + "/api/requests" && response.request().method() === "POST");
  await page.getByRole("button",{ name: "Send request", exact: true }).click();
  const response = await waiting; assert.equal(response.status(),expected);
  if (expected === 200) await page.getByRole("heading",{ name: "Your request has been received.",exact:true }).waitFor();
  else await page.locator("main").getByRole("alert").waitFor();
  return response;
}
async function apiRequest(c: Context, kind: RequestKind, extra: Partial<PublicRequestInput> = {}) {
  const input: PublicRequestInput = { submissionId: randomUUID(), kind, name: "Local Inbox Fixture", message: "LOCAL TEST ONLY. A private synthetic customer request for verification.", ...extra, email: fixture.customerEmail! };
  const response = await c.request.post(origin + "/api/requests",{ headers:{ Origin:origin },data:input }); assert.equal(response.status(),200); return input;
}
async function adminPost(page: Page, path: string, button: string, expected = 200) {
  const waiting = page.waitForResponse((response: { url(): string; request(): { method(): string } }) => response.url() === origin + path && response.request().method() === "POST");
  await page.getByRole("button",{ name:button,exact:true }).click(); const response = await waiting; assert.equal(response.status(),expected); return response;
}

// Browser plugin not available. These regressions exercise the production Next
// server and its real router cache through the existing Playwright HTTPS fixture.
const inboxPath = "/admin/requests", searchPath = "/api/admin/requests/search";
type PrivateWindow = Window & typeof globalThis & {
  __requestDocument?: string;
  __requestPrivacy?: { exposures: number; observer: MutationObserver; inspect: () => void };
};
function gate() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function bounded<T>(promise: Promise<T>, description: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise,new Promise<never>((_,reject) => { timer = setTimeout(() => reject(new Error(description)),15000); })]); }
  finally { if (timer) clearTimeout(timer); }
}
function privateFields(request: PublicRequestInput) { return [request.name,request.email!,request.phone!,request.message].filter(Boolean); }
async function sentinelRequest(c: Context) {
  const unique = token();
  return apiRequest(c,"BESPOKE",{ name:`LOCAL PRIVATE CUSTOMER ${unique}`,email:`private-${unique}@boutique.test`,phone:`+20100${Date.now().toString().slice(-6)}`,message:`LOCAL PRIVATE MESSAGE ${unique}` });
}
async function openInbox(page: Page, request: PublicRequestInput, withDetails = true) {
  await signIn(page,"OWNER"); await page.getByRole("link",{name:"Manage boutique requests",exact:true}).click();
  await page.getByRole("button",{name:`Open request ${request.submissionId}`,exact:true}).waitFor();
  if (withDetails) { await page.getByRole("button",{name:`Open request ${request.submissionId}`,exact:true}).click(); await page.getByText(request.message,{exact:true}).waitFor(); }
}
async function markDocument(page: Page) { const value = token(); await page.evaluate((value: string) => { (window as PrivateWindow).__requestDocument = value; },value); return value; }
async function sameDocument(page: Page, value: string) { assert.equal(await page.evaluate(() => (window as PrivateWindow).__requestDocument),value,"This regression must use a Next client transition in the same document."); }
async function leaveInbox(page: Page) {
  const identity = await markDocument(page);
  await page.getByRole("link",{name:"Administration",exact:true}).click(); await page.waitForURL(origin + "/admin");
  await sameDocument(page,identity); return identity;
}
async function watchPrivateDOM(page: Page, fields: string[]) {
  await page.evaluate((fields: string[]) => {
    const previous = (window as PrivateWindow).__requestPrivacy; previous?.observer.disconnect();
    const state = { exposures:0,observer:null as unknown as MutationObserver,inspect:() => {} };
    const containsPrivate = (value: string | null) => Boolean(value && fields.some(field => value.includes(field)));
    const inspectNode = (node: Node) => {
      // Include nodes removed again in the same task: querying only the final
      // document would miss an unauthorized frame during history restoration.
      if (containsPrivate(node.textContent)) state.exposures++;
      if (node instanceof Element) for (const element of [node,...node.querySelectorAll("input,textarea,a")]) {
        if (containsPrivate(element.getAttribute("value")) || containsPrivate(element.getAttribute("href")) || (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && containsPrivate(element.value)) state.exposures++;
      }
    };
    state.inspect = () => { const main = document.querySelector("main"); if (main) inspectNode(main); };
    state.observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === "childList") { for (const node of record.addedNodes) inspectNode(node); }
        else if (record.type === "characterData" && (containsPrivate(record.oldValue) || containsPrivate(record.target.textContent))) state.exposures++;
        else if (record.type === "attributes" && record.target instanceof Element && containsPrivate(record.target.getAttribute(record.attributeName!))) state.exposures++;
      }
      state.inspect();
    });
    state.observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,characterDataOldValue:true,attributes:true,attributeFilter:["value","href"]});
    (window as PrivateWindow).__requestPrivacy = state; state.inspect();
  },fields);
}
async function assertPrivateEmpty(page: Page, fields: string[]) {
  assert.equal(await page.evaluate((fields: string[]) => {
    const main = document.querySelector("main"); return fields.some(field => main?.textContent?.includes(field));
  },fields),false,"Private customer fields must remain absent until a new authorized fetch succeeds.");
  assert.equal(await page.getByRole("button",{name:/^Open request /}).count(),0);
  assert.equal(await page.getByRole("heading",{name:"Request details",exact:true}).count(),0);
  assert.equal(await page.getByRole("button",{name:"Save request update",exact:true}).count(),0);
  const observed = await page.evaluate(() => { const state = (window as PrivateWindow).__requestPrivacy; state?.inspect(); return state?.exposures ?? 0; });
  assert.equal(observed,0,"A MutationObserver detected private customer data, including a transient DOM insertion.");
}
async function stopWatching(page: Page) {
  const exposures = await page.evaluate(() => { const state = (window as PrivateWindow).__requestPrivacy; state?.inspect(); state?.observer.disconnect(); return state?.exposures ?? 0; });
  assert.equal(exposures,0,"No private DOM may appear before protected reauthorization completes.");
}
function searchResponse(page: Page) { return page.waitForResponse((response: {url():string;request():{method():string}}) => response.url() === origin + searchPath && response.request().method() === "POST"); }
async function heldResponse(page: Page, endpoint: string, method: "GET" | "POST") {
  const released = gate(), pending = new Set<Promise<void>>(), searchRead = endpoint === origin + searchPath && method === "POST";
  let progress = gate(), captured = false, failed = false, attempts = 0;
  const notify = () => { const previous = progress; progress = gate(); previous.resolve(); };
  await page.route(endpoint,async(route: {request():{method():string};fetch(options:{timeout:number}):Promise<{status():number}>;fulfill(value:unknown):Promise<void>;continue():Promise<void>}) => {
    if (route.request().method() !== method || captured && !searchRead) { await route.continue(); return; }
    captured = true;
    const settled = gate(); pending.add(settled.promise);
    try {
      // This is the actual fixture-server response. For POST updates its audit
      // and mutation have already committed before the browser receipt is held.
      const response = await route.fetch({timeout:15000});
      if (searchRead && [401,403].includes(response.status())) {
        try { await route.fulfill({response}); } catch { /* A superseded read may already be aborted. */ }
        return;
      }
      assert.equal(response.status(),200,"The delayed fixture operation must succeed on the server."); attempts++; notify();
      // Focus and visibility restoration can each start a fresh authorized
      // search. Hold every successful search receipt behind this same gate;
      // otherwise a second valid read can bypass the empty-DOM checkpoint.
      await bounded(released.promise,"The deferred fixture response was not released.");
      try { await route.fulfill({response}); } catch { /* Abort on leave/hide is an expected successful defense. */ }
    } catch { failed = true; notify(); }
    finally { pending.delete(settled.promise); settled.resolve(); }
  });
  return {
    async ready(expected = 1) { await bounded((async () => { while (attempts < expected && !failed) await progress.promise; })(),"The expected protected operation did not reach the fixture server."); assert.equal(failed,false,"The protected fixture operation failed before its deferred receipt."); },
    async release() { released.resolve(); await bounded((async () => { while (pending.size) await Promise.all([...pending]); })(),"The deferred fixture operations did not settle."); assert.equal(failed,false,"The deferred fixture response failed."); },
    unblock() { released.resolve(); }, count() { return attempts; },
  };
}
async function settleVisibleDOM(page: Page) {
  await bounded(page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())))),"The restored page did not paint.");
}
async function requestCount(page: Page, expected: number) {
  await page.waitForFunction((expected: number) => [...document.querySelectorAll("button")].filter(button => /^Open request /.test(button.textContent || "")).length === expected,expected,{timeout:15000});
  assert.equal(await page.getByRole("button",{name:/^Open request /}).count(),expected);
}
async function backgroundInbox(c: Context, page: Page) {
  // The cached in-process Playwright controller enables per-session focus
  // emulation. Only its own CDP session can remove that automation override;
  // a newly attached CDP session leaves every tab artificially visible.
  type Delegate = { _mainFrameSession?: { _client?: { send(method: string,params: {enabled:boolean}): Promise<unknown> } } };
  type ControlledPage = { _connection?: { toImpl(value: unknown): { delegate?: Delegate; _delegate?: Delegate } } };
  const nativeFocus = async (target: Page) => {
    const connection = (target as unknown as ControlledPage)._connection;
    const implementation = connection?.toImpl(target);
    const controller = (implementation?._delegate ?? implementation?.delegate)?._mainFrameSession?._client;
    assert.ok(controller && typeof controller.send === "function","Native tab visibility requires the cached in-process Playwright Chromium controller.");
    await controller.send("Emulation.setFocusEmulationEnabled",{enabled:false});
  };
  await nativeFocus(page); const other = await c.newPage(); await nativeFocus(other);
  await other.goto(origin + "/contact"); await other.bringToFront();
  await page.waitForFunction(() => document.visibilityState === "hidden",{},{timeout:15000,polling:100});
  return other;
}

test("quotation catalogue keeps selected out-of-stock configurations, known metals and all five authenticated request journeys", { timeout:150000 }, async () => {
  const c = await context();
  try {
    await fixture.data.query("UPDATE product_variants SET metal_type=NULL,metal_purity='18K',metal_color='Yellow',metal_weight_grams=3.250,metal_weight_basis='ACTUAL' WHERE id=$1",[id(207)]);
    const page = await c.newPage(), errors: string[] = []; page.on("pageerror",() => errors.push("Page runtime error"));
    await page.goto(origin); assert.equal(await page.getByRole("link",{ name:/shopping bag/i }).count(),0);
    await page.goto(origin + "/jewels/dev-repeatable-earrings");
    await page.getByRole("radio",{ name:/Development alternate/ }).check();
    assert.match(await page.locator("main").innerText(),/Price on Request/);
    assert.ok(!(await page.locator("main").innerText()).includes("2,650"));
    assert.equal(await page.getByRole("button",{ name:/Add.*bag/i }).count(),0);
    assert.match(await page.locator("main").innerText(),/18K.*Yellow/); assert.match(await page.locator("main").innerText(),/3\.25 g \(actual\)/);
    const receipts: string[] = [];
    for (const kind of ["QUOTATION","MODIFICATION"] as const) {
      await page.getByRole("link",{ name:kind === "QUOTATION" ? "Request a Quotation" : "Request Changes",exact:true }).click();
      assert.equal(await page.getByLabel("Selected configuration",{ exact:true }).inputValue(),id(207));
      await details(page); const response = await send(page); const receipt = await response.json(); receipts.push(receipt.reference);
      assert.deepEqual(Object.keys(receipt).sort(),["message","reference"]); assert.match(response.headers()["cache-control"],/private.*no-store/);
      const table = kind === "QUOTATION" ? "product_enquiries" : "bespoke_requests";
      const row = (await fixture.data.query(`SELECT product_id,variant_id,product_context FROM ${table} WHERE id=$1`,[receipt.reference])).rows[0];
      assert.equal(row.product_id,id(102)); assert.equal(row.variant_id,id(207)); assert.equal(row.product_context.sku,"DEV-207");
      await page.goto(origin + "/jewels/dev-repeatable-earrings"); await page.getByRole("radio",{ name:/Development alternate/ }).check();
    }
    await page.goto(origin + "/contact?intent=BESPOKE"); await details(page); receipts.push((await (await send(page)).json()).reference);
    for (const channel of ["ZOOM","BOUTIQUE"] as const) {
      await page.goto(origin + "/appointment"); await details(page); await page.getByLabel("Consultation preference",{ exact:true }).selectOption(channel);
      await page.getByLabel("Preferred date (Africa/Cairo)",{ exact:true }).fill("2030-01-15"); await page.getByLabel("Preferred time (Africa/Cairo)",{ exact:true }).fill("14:30");
      const receipt = await (await send(page)).json(); receipts.push(receipt.reference);
      const row = (await fixture.data.query("SELECT consultation_channel,preferred_start_at::TEXT,status FROM appointment_requests WHERE id=$1",[receipt.reference])).rows[0];
      assert.equal(row.consultation_channel,channel); assert.match(row.preferred_start_at,/2030-01-15 12:30:00/); assert.equal(row.status,"NEW");
    }
    const count = (await fixture.data.query("SELECT (SELECT count(*) FROM product_enquiries WHERE id=ANY($1::uuid[]))+(SELECT count(*) FROM bespoke_requests WHERE id=ANY($1::uuid[]))+(SELECT count(*) FROM appointment_requests WHERE id=ANY($1::uuid[])) AS n",[receipts])).rows[0].n;
    assert.equal(Number(count),5); assert.equal((await fixture.data.query("SELECT count(*) FROM orders")).rows[0].count,"0");
    assert.equal((await c.request.get(origin + "/api/requests")).status(),405); assert.deepEqual(errors,[]);
  } finally { await c.close(); }
});

test("Zoom contact errors and Cairo clock-change validation preserve editable form values", async () => {
  const c = await context();
  try {
    const page = await c.newPage(); await page.goto(origin + "/appointment"); await details(page);
    assert.equal(await page.getByRole("textbox",{ name:/^Email/ }).getAttribute("readonly"), ""); await page.getByLabel("Telephone",{ exact:true }).fill("invalid");
    await send(page,400); await page.waitForFunction(() => document.activeElement?.getAttribute("name") === "phone");
    assert.equal(await page.locator('textarea[name="message"]').inputValue(),"LOCAL TEST ONLY. Please discuss this synthetic request with the boutique.");
    await page.getByLabel("Telephone",{ exact:true }).fill("+201001234567"); await page.getByLabel("Preferred date (Africa/Cairo)",{ exact:true }).fill("2027-04-30"); await page.getByLabel("Preferred time (Africa/Cairo)",{ exact:true }).fill("00:30");
    await send(page,400); assert.match(await page.locator("main").getByRole("alert").innerText(),/clock|unavailable|ambiguous/i);
    assert.equal(await page.getByLabel("Your name (required)",{ exact:true }).inputValue(),"Local Request Fixture");
    await page.getByLabel("Preferred date (Africa/Cairo)",{ exact:true }).fill("2030-01-15"); await page.getByLabel("Preferred time (Africa/Cairo)",{ exact:true }).fill("14:30"); await send(page);
    assert.equal(page.url(),origin + "/appointment");
  } finally { await c.close(); }
});

test("uncertain authenticated receipt retries only the identical frozen submission and creates one record", async () => {
  const c = await context(); let attempts = 0; const bodies: unknown[] = [];
  try {
    const page = await c.newPage(); await page.goto(origin + "/contact?intent=BESPOKE"); await details(page);
    await page.route(origin + "/api/requests",async (route: { request(): { postDataJSON(): unknown }; fetch(): Promise<unknown>; fulfill(value: unknown): Promise<void>; continue(): Promise<void> }) => {
      attempts++; bodies.push(route.request().postDataJSON());
      if (attempts === 1) { await route.fetch(); await route.fulfill({ status:503,json:{ message:"Synthetic lost receipt after commit." } }); } else await route.continue();
    });
    await send(page,503); assert.equal(await page.getByLabel("Your name (required)",{ exact:true }).isDisabled(),true);
    await page.waitForTimeout(100); assert.equal(attempts,1);
    const waiting = page.waitForResponse((response: { url(): string; request(): { method(): string } }) => response.url() === origin + "/api/requests" && response.request().method() === "POST");
    await page.getByRole("button",{ name:"Retry this same request",exact:true }).click(); assert.equal((await waiting).status(),200);
    await page.getByRole("heading",{ name:"Your request has been received.",exact:true }).waitFor();
    assert.equal(attempts,2); assert.deepEqual(bodies[0],bodies[1]);
    const body = bodies[0] as PublicRequestInput; assert.equal((await fixture.data.query("SELECT count(*) FROM bespoke_requests WHERE id=$1",[body.submissionId])).rows[0].count,"1");
    assert.equal((await fixture.data.query("SELECT count(*) FROM audit_events WHERE action='REQUEST_RECEIVED' AND target_id=$1",[body.submissionId])).rows[0].count,"1");
    assert.ok(!page.url().includes(body.email!)); assert.ok(!(await page.content()).includes(body.email!));
  } finally { await c.close(); }
});

test("operations inbox filters, preserves private original context, assigns follow-up and confirms a boutique time", { timeout:120000 }, async () => {
  const c = await context();
  try {
    const request = await apiRequest(c,"MODIFICATION",{ productId:id(102),variantId:id(207) });
    const consultation = await apiRequest(c,"CONSULTATION",{ channel:"BOUTIQUE" });
    const location = (await fixture.data.query("INSERT INTO boutique_locations(name,governorate,city_area,street_address,is_active) VALUES('LOCAL TEST ONLY location','Cairo','Local area','Local synthetic street',true) RETURNING id")).rows[0].id;
    const page = await c.newPage(); await signIn(page,"ADMIN"); await page.getByRole("link",{ name:"Manage boutique requests",exact:true }).click();
    await page.getByRole("heading",{ name:"Boutique requests",exact:true }).waitFor();
    await page.getByLabel("Request type",{ exact:true }).selectOption("MODIFICATION"); await page.getByLabel("Request status",{ exact:true }).selectOption("NEW");
    await adminPost(page,"/api/admin/requests/search","Refresh requests"); await page.getByRole("button",{ name:`Open request ${request.submissionId}`,exact:true }).click();
    await page.getByRole("heading",{ name:"Request details",exact:true }).waitFor(); assert.ok((await page.locator("main").innerText()).includes(request.email!));
    assert.ok(await page.getByRole("region",{ name:"Original jewelry context",exact:true }).isVisible());
    await page.getByLabel("Update status",{ exact:true }).selectOption("CONTACTED"); await page.getByLabel("Assigned employee",{ exact:true }).selectOption(fixture.users.ADMIN.id);
    await adminPost(page,`/api/admin/requests/MODIFICATION/${request.submissionId}`,"Save request update");
    assert.deepEqual((await fixture.data.query("SELECT status,assigned_admin_id FROM bespoke_requests WHERE id=$1",[request.submissionId])).rows[0],{ status:"CONTACTED",assigned_admin_id:fixture.users.ADMIN.id });
    await page.getByLabel("Request type",{ exact:true }).selectOption("CONSULTATION"); await page.getByLabel("Request status",{ exact:true }).selectOption("NEW"); await adminPost(page,"/api/admin/requests/search","Refresh requests");
    await page.getByRole("button",{ name:`Open request ${consultation.submissionId}`,exact:true }).click();
    await page.getByText(`Reference: ${consultation.submissionId}`,{ exact:true }).waitFor();
    await page.getByLabel("Update status",{ exact:true }).selectOption("CONFIRMED");
    await page.getByLabel("Confirmed date (Africa/Cairo)",{ exact:true }).fill("2030-01-15"); await page.getByLabel("Confirmed time (Africa/Cairo)",{ exact:true }).fill("15:00");
    await page.getByLabel("Verified boutique location",{ exact:true }).selectOption(location); await page.getByRole("checkbox",{ name:/I have agreed these arrangements/ }).check();
    await adminPost(page,`/api/admin/requests/CONSULTATION/${consultation.submissionId}`,"Save request update");
    const saved = (await fixture.data.query("SELECT status,confirmed_start_at::TEXT,boutique_location_id FROM appointment_requests WHERE id=$1",[consultation.submissionId])).rows[0]; assert.equal(saved.status,"CONFIRMED"); assert.match(saved.confirmed_start_at,/2030-01-15 13:00:00/); assert.equal(saved.boutique_location_id,location);
    assert.ok(!(await page.content()).includes(fixture.authConfig.secret));
  } finally { await c.close(); }
});

test("request privacy denies anonymous and catalogue-manager access while public forms remain responsive", async () => {
  const anonymous = await context(), manager = await context();
  try {
    const privateRequest = await apiRequest(anonymous,"BESPOKE");
    assert.equal((await anonymous.request.post(origin + "/api/admin/requests/search",{ headers:{Origin:origin},data:{} })).status(),401);
    const page = await manager.newPage(); await signIn(page,"CATALOGUE_MANAGER"); assert.equal(await page.getByRole("link",{name:"Manage boutique requests",exact:true}).count(),0);
    await page.goto(origin + "/admin/requests"); await page.getByRole("heading",{ name:"Request access unavailable",exact:true }).waitFor(); assert.ok(!(await page.content()).includes(privateRequest.email!));
    for (const method of ["get","post"] as const) { const result = await manager.request[method](origin + `/api/admin/requests/BESPOKE/${privateRequest.submissionId}`,method === "post" ? { headers:{Origin:origin},data:{status:"CONTACTED"} } : {}); assert.equal(result.status(),403); }
    assert.equal((await manager.request.post(origin + "/api/admin/requests/search",{headers:{Origin:origin},data:{}})).status(),403);
    const visitor = await anonymous.newPage();
    for (const width of [320,768,1024,1440]) {
      await visitor.setViewportSize({width,height:1000}); await visitor.goto(origin + "/appointment");
      assert.ok(await visitor.evaluate(() => document.documentElement.scrollWidth <= innerWidth),`Request form fits ${width}px`);
      await screenshot(visitor,`requests-public-${width}`);
    }
  } finally { await anonymous.close(); await manager.close(); }
});

test("initial inbox HTML and real RSC payload contain no private customer fields before protected client authorization", {timeout:60000}, async () => {
  const c = await context(); let held: Awaited<ReturnType<typeof heldResponse>> | undefined;
  try {
    const request = await sentinelRequest(c), fields = privateFields(request), page = await c.newPage(); await signIn(page,"OWNER");
    held = await heldResponse(page,origin + searchPath,"POST");
    const documentResponse = await page.goto(origin + inboxPath,{waitUntil:"domcontentloaded"}); assert.ok(documentResponse); assert.equal(documentResponse.status(),200);
    const html = await documentResponse.text();
    assert.equal(fields.some(field => html.includes(field)),false,"Server HTML must never serialize private inbox records into the router cache.");
    const rsc = await c.request.get(origin + inboxPath + `?_rsc=privacy-${token()}`,{headers:{RSC:"1"},timeout:15000});
    assert.equal(rsc.status(),200); assert.match(rsc.headers()["content-type"],/text\/x-component/);
    const payload = await rsc.text(); assert.equal(fields.some(field => payload.includes(field)),false,"Real RSC payloads must not carry private customer records.");
    await held.ready(); await watchPrivateDOM(page,fields); await assertPrivateEmpty(page,fields);
    await stopWatching(page); await held.release();
    await page.getByRole("button",{name:`Open request ${request.submissionId}`,exact:true}).waitFor();
  } finally { held?.unblock(); await c.close(); }
});

for (const revocation of ["session","role"] as const) test(`Next Link navigation and browser Back never flash cached private fields after ${revocation} revocation`, {timeout:90000}, async () => {
  const c = await context();
  try {
    const request = await sentinelRequest(c), fields = privateFields(request), page = await c.newPage(); await openInbox(page,request);
    const identity = await leaveInbox(page); await watchPrivateDOM(page,fields);
    if (revocation === "session") await fixture.data.query("DELETE FROM admin_auth_sessions WHERE user_id=$1",[fixture.users.OWNER.id]);
    else await fixture.data.query("UPDATE admin_users SET role='CATALOGUE_MANAGER' WHERE id=$1",[fixture.users.OWNER.id]);
    const denied = searchResponse(page); await page.goBack(); await page.waitForURL(origin + inboxPath); await sameDocument(page,identity);
    assert.equal((await denied).status(),revocation === "session" ? 401 : 403);
    await page.locator("main").getByRole("alert").filter({hasText:"Private request access is unavailable"}).waitFor();
    await settleVisibleDOM(page); await assertPrivateEmpty(page,fields);
  } finally {
    if (revocation === "role") await fixture.data.query("UPDATE admin_users SET role='OWNER' WHERE id=$1",[fixture.users.OWNER.id]);
    await c.close();
  }
});

test("authorized browser Back keeps cached inbox and details empty until its new protected search succeeds", {timeout:60000}, async () => {
  const c = await context(); let held: Awaited<ReturnType<typeof heldResponse>> | undefined;
  try {
    const request = await sentinelRequest(c), fields = privateFields(request), page = await c.newPage(); await openInbox(page,request);
    const identity = await leaveInbox(page); await watchPrivateDOM(page,fields); held = await heldResponse(page,origin + searchPath,"POST");
    await page.goBack(); await page.waitForURL(origin + inboxPath); await sameDocument(page,identity); await held.ready();
    await settleVisibleDOM(page); await assertPrivateEmpty(page,fields);
    await stopWatching(page); await held.release();
    await page.getByRole("button",{name:`Open request ${request.submissionId}`,exact:true}).waitFor();
    assert.equal(await page.getByRole("heading",{name:"Request details",exact:true}).count(),0,"A new search must not restore the previous private detail or draft.");
    await page.getByRole("button",{name:`Open request ${request.submissionId}`,exact:true}).click(); await page.getByText(request.message,{exact:true}).waitFor();
  } finally { held?.unblock(); await c.close(); }
});

test("failed or malformed protected search and detail receipts clear every private record and require an explicit retry", {timeout:120000}, async () => {
  for (const operation of ["search503","load503","searchMalformed","loadMalformed"] as const) {
    const c = await context(); let attempts = 0;
    try {
      const request = await sentinelRequest(c), fields = privateFields(request), page = await c.newPage(); await openInbox(page,request);
      const searching = operation.startsWith("search"), endpoint = origin + (searching ? searchPath : `/api/admin/requests/BESPOKE/${request.submissionId}`);
      await page.route(endpoint,async(route: {fetch():Promise<{status():number}>;fulfill(value:unknown):Promise<void>}) => {
        attempts++; assert.equal((await route.fetch()).status(),200);
        await route.fulfill({status:operation.endsWith("503") ? 503 : 200,json:operation.endsWith("503") ? {message:"Synthetic protected service unavailable."} : {invalid:"Synthetic malformed protected receipt."}});
      });
      await page.getByRole("button",{name:searching ? "Refresh requests" : "Reload saved request",exact:true}).click();
      await page.locator("main").getByRole("alert").waitFor(); await assertPrivateEmpty(page,fields);
      await watchPrivateDOM(page,fields); await settleVisibleDOM(page); await assertPrivateEmpty(page,fields); assert.equal(attempts,1,"Failed protected reads must not retry themselves.");
      await stopWatching(page); await page.unroute(endpoint); await adminPost(page,searchPath,"Refresh requests");
      await page.getByRole("button",{name:`Open request ${request.submissionId}`,exact:true}).waitFor();
      assert.equal(await page.getByRole("heading",{name:"Request details",exact:true}).count(),0);
    } finally { await c.close(); }
  }
});

for (const operation of ["search","load","save"] as const) for (const lifecycle of ["leave","background","denial"] as const) test(`a delayed real ${operation} response cannot restore private data after ${lifecycle}`, {timeout:90000}, async () => {
  const c = await context(); let held: Awaited<ReturnType<typeof heldResponse>> | undefined;
  try {
    const request = await sentinelRequest(c), fields = privateFields(request), page = await c.newPage(); page.on("dialog",(dialog: {accept():Promise<void>}) => dialog.accept());
    await openInbox(page,request,operation !== "load");
    const endpoint = origin + (operation === "search" ? searchPath : `/api/admin/requests/BESPOKE/${request.submissionId}`);
    held = await heldResponse(page,endpoint,operation === "load" ? "GET" : "POST");
    if (operation === "search") await page.getByRole("button",{name:"Refresh requests",exact:true}).click();
    else if (operation === "load") await page.getByRole("button",{name:`Open request ${request.submissionId}`,exact:true}).click();
    else { await page.getByLabel("Update status",{exact:true}).selectOption("CONTACTED"); await page.getByRole("button",{name:"Save request update",exact:true}).click(); }
    await held.ready();
    if (operation === "save") {
      assert.equal((await fixture.data.query("SELECT status FROM bespoke_requests WHERE id=$1",[request.submissionId])).rows[0].status,"CONTACTED");
      assert.equal((await fixture.data.query("SELECT count(*) FROM audit_events WHERE action='REQUEST_UPDATED' AND target_id=$1",[request.submissionId])).rows[0].count,"1");
    }
    if (lifecycle === "leave") {
      const identity = await leaveInbox(page); await watchPrivateDOM(page,fields);
      await fixture.data.query("DELETE FROM admin_auth_sessions WHERE user_id=$1",[fixture.users.OWNER.id]);
      const denied = searchResponse(page); await page.goBack(); await page.waitForURL(origin + inboxPath); await sameDocument(page,identity); assert.equal((await denied).status(),401);
      await page.locator("main").getByRole("alert").filter({hasText:"Private request access is unavailable"}).waitFor();
    } else if (lifecycle === "background") {
      await backgroundInbox(c,page);
      await page.locator("main").getByRole("alert").filter({hasText:"Private request details were hidden"}).waitFor();
      await assertPrivateEmpty(page,fields); await watchPrivateDOM(page,fields);
      // Settle the old receipt while the real tab remains hidden. It must stay
      // empty both in the background and after the foreground authorization fails.
      await held.release(); await assertPrivateEmpty(page,fields);
      await fixture.data.query("DELETE FROM admin_auth_sessions WHERE user_id=$1",[fixture.users.OWNER.id]);
      const denied = searchResponse(page); await page.bringToFront(); assert.equal((await denied).status(),401);
      await page.locator("main").getByRole("alert").filter({hasText:"Private request access is unavailable"}).waitFor();
    } else {
      // Synthetic pagehide additionally covers the persisted-page lifecycle;
      // the background branch above separately requires actual tab visibility.
      await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
      await page.locator("main").getByRole("alert").filter({hasText:"Private request details were hidden"}).waitFor();
      await assertPrivateEmpty(page,fields); await watchPrivateDOM(page,fields);
      await fixture.data.query("DELETE FROM admin_auth_sessions WHERE user_id=$1",[fixture.users.OWNER.id]);
      await adminPost(page,searchPath,"Refresh requests",401);
      await page.locator("main").getByRole("alert").filter({hasText:"Private request access is unavailable"}).waitFor();
    }
    if (lifecycle !== "background") await held.release();
    await settleVisibleDOM(page); await assertPrivateEmpty(page,fields); assert.equal(held.count(),1,"The delayed operation must not be retried.");
    if (operation === "save") assert.equal((await fixture.data.query("SELECT count(*) FROM audit_events WHERE action='REQUEST_UPDATED' AND target_id=$1",[request.submissionId])).rows[0].count,"1");
  } finally { held?.unblock(); await c.close(); }
});

test("a real background tab clears private data, denies a revoked session and reauthorizes only after session restoration", {timeout:90000}, async () => {
  const c = await context(); let held: Awaited<ReturnType<typeof heldResponse>> | undefined;
  try {
    const request = await sentinelRequest(c), fields = privateFields(request), page = await c.newPage(); await openInbox(page,request);
    const identity = await markDocument(page), other = await backgroundInbox(c,page);
    await page.locator("main").getByRole("alert").filter({hasText:"Private request details were hidden"}).waitFor(); await assertPrivateEmpty(page,fields); await watchPrivateDOM(page,fields);
    await fixture.data.query("DELETE FROM admin_auth_sessions WHERE user_id=$1",[fixture.users.OWNER.id]);
    const denied = searchResponse(page); await page.bringToFront(); assert.equal((await denied).status(),401);
    await page.locator("main").getByRole("alert").filter({hasText:"Private request access is unavailable"}).waitFor(); await assertPrivateEmpty(page,fields);
    await other.bringToFront(); await page.waitForFunction(() => document.visibilityState === "hidden",{},{timeout:15000,polling:100}); await signIn(other,"OWNER");
    held = await heldResponse(page,origin + searchPath,"POST"); await page.bringToFront(); await held.ready();
    await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await held.ready(2); await sameDocument(page,identity);
    await assertPrivateEmpty(page,fields); await stopWatching(page); await held.release();
    await page.getByRole("button",{name:`Open request ${request.submissionId}`,exact:true}).waitFor(); assert.equal(await page.getByRole("heading",{name:"Request details",exact:true}).count(),0);
    await page.getByRole("button",{name:`Open request ${request.submissionId}`,exact:true}).click(); await page.getByText(request.message,{exact:true}).waitFor();
  } finally { held?.unblock(); await c.close(); }
});

test("persisted pageshow and forward history keep the inbox empty until fresh protected authorization", {timeout:90000}, async () => {
  const c = await context(); let held: Awaited<ReturnType<typeof heldResponse>> | undefined;
  try {
    const request = await sentinelRequest(c), fields = privateFields(request), page = await c.newPage(); await openInbox(page,request);
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await page.locator("main").getByRole("alert").filter({hasText:"Private request details were hidden"}).waitFor(); await watchPrivateDOM(page,fields);
    held = await heldResponse(page,origin + searchPath,"POST");
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow",{persisted:true}))); await held.ready();
    await assertPrivateEmpty(page,fields); await stopWatching(page); await held.release();
    await page.getByRole("button",{name:`Open request ${request.submissionId}`,exact:true}).waitFor();
    const identity = await leaveInbox(page); await page.goBack(); await page.getByRole("button",{name:`Open request ${request.submissionId}`,exact:true}).waitFor(); await sameDocument(page,identity);
    await page.goForward(); await page.waitForURL(origin + "/admin"); await sameDocument(page,identity);
    await watchPrivateDOM(page,fields); await fixture.data.query("DELETE FROM admin_auth_sessions WHERE user_id=$1",[fixture.users.OWNER.id]);
    const denied = searchResponse(page); await page.goBack(); await page.waitForURL(origin + inboxPath); await sameDocument(page,identity); assert.equal((await denied).status(),401);
    await page.locator("main").getByRole("alert").filter({hasText:"Private request access is unavailable"}).waitFor(); await assertPrivateEmpty(page,fields);
  } finally { held?.unblock(); await c.close(); }
});

test("authorized inbox pagination preserves filters and signing out prevents private history restoration", {timeout:90000}, async () => {
  const c = await context();
  try {
    const unique = token(), records = Array.from({length:21},(_,index) => ({id:randomUUID(),name:`LOCAL PAGINATION ${unique} ${index}`,email:`pagination-${unique}-${index}@boutique.test`,message:`LOCAL PAGINATION MESSAGE ${unique} ${index}`}));
    await fixture.data.query("INSERT INTO bespoke_requests(id,contact_name,contact_email,message,status) SELECT id::uuid,name,email,message,'IN_DESIGN' FROM jsonb_to_recordset($1::jsonb) AS r(id TEXT,name TEXT,email TEXT,message TEXT)",[JSON.stringify(records)]);
    const page = await c.newPage(); await signIn(page,"OWNER"); await page.getByRole("link",{name:"Manage boutique requests",exact:true}).click();
    await page.getByRole("button",{name:/^Open request /}).first().waitFor();
    await page.getByLabel("Request type",{exact:true}).selectOption("BESPOKE"); await page.getByLabel("Request status",{exact:true}).selectOption("IN_DESIGN"); await adminPost(page,searchPath,"Refresh requests");
    await requestCount(page,20);
    await adminPost(page,searchPath,"Next requests"); await requestCount(page,1);
    assert.equal(await page.getByLabel("Request type",{exact:true}).inputValue(),"BESPOKE"); assert.equal(await page.getByLabel("Request status",{exact:true}).inputValue(),"IN_DESIGN");
    assert.equal(await page.getByRole("button",{name:"Next requests",exact:true}).count(),0);
    await adminPost(page,searchPath,"Previous requests"); await requestCount(page,20);
    await page.getByRole("button",{name:/^Open request /}).first().click(); await page.getByRole("heading",{name:"Request details",exact:true}).waitFor();
    await leaveInbox(page); await page.getByRole("button",{name:"Sign out",exact:true}).click(); await page.waitForURL(origin + "/admin/login");
    await page.goBack({waitUntil:"domcontentloaded"}); await page.waitForURL(origin + "/admin/login",{waitUntil:"networkidle"});
    await page.getByRole("heading",{name:"Administrator sign-in",exact:true}).waitFor();
    const containsPrivate = await page.evaluate((fields: string[]) => fields.some(field => document.documentElement.outerHTML.includes(field)),records.flatMap(record => [record.name,record.email,record.message]));
    assert.equal(containsPrivate,false,"Signed-out history restoration must contain no private customer fields.");
    assert.equal((await c.request.post(origin + searchPath,{headers:{Origin:origin},data:{},timeout:15000})).status(),401);
  } finally { await c.close(); }
});

test("an uncertain staff update requires read-only reconciliation and never repeats the mutation", async () => {
  const c = await context(); let attempts = 0;
  try {
    const request = await apiRequest(c,"BESPOKE"), page = await c.newPage();
    page.on("dialog",(dialog: { accept(): Promise<void> }) => dialog.accept());
    await signIn(page,"ADMIN"); await page.goto(origin + "/admin/requests");
    await page.getByRole("button",{name:`Open request ${request.submissionId}`,exact:true}).click(); await page.getByRole("heading",{name:"Request details",exact:true}).waitFor();
    await page.getByLabel("Update status",{exact:true}).selectOption("CONTACTED");
    const endpoint = origin + `/api/admin/requests/BESPOKE/${request.submissionId}`;
    await page.route(endpoint,async(route: { request(): { method(): string }; fetch(): Promise<{ status(): number }>; fulfill(value:unknown):Promise<void>;continue():Promise<void> }) => {
      if (route.request().method() !== "POST") { await route.continue(); return; }
      attempts++; assert.equal((await route.fetch()).status(),200); await route.fulfill({status:503,json:{message:"Synthetic lost update receipt."}});
    });
    await adminPost(page,`/api/admin/requests/BESPOKE/${request.submissionId}`,"Save request update",503);
    await page.locator("main").getByRole("alert").filter({hasText:"outcome is uncertain"}).waitFor();
    assert.equal(await page.getByRole("button",{name:"Save request update",exact:true}).count(),0);
    assert.equal(await page.getByRole("heading",{name:"Request details",exact:true}).count(),0);
    assert.equal(await page.getByRole("button",{name:/^Open request /}).count(),0);
    assert.equal((await page.locator("main").innerText()).includes(request.email!),false);
    await page.getByRole("button",{name:"Reload saved request",exact:true}).click(); await page.getByRole("status").filter({hasText:"Current saved request loaded."}).waitFor();
    assert.equal(await page.getByLabel("Update status",{exact:true}).inputValue(),"CONTACTED"); assert.equal(attempts,1);
    assert.equal((await fixture.data.query("SELECT count(*) FROM audit_events WHERE action='REQUEST_UPDATED' AND target_id=$1",[request.submissionId])).rows[0].count,"1");
  } finally { await c.close(); }
});

test("private inbox and saved request details fit required widths without runtime errors", async () => {
  const c = await context();
  try {
    const request = await apiRequest(c,"BESPOKE",{message:"LOCAL TEST ONLY. " + "A detailed synthetic design conversation. ".repeat(40)}), page = await c.newPage(), errors: string[] = [];
    page.on("pageerror",() => errors.push("Page runtime error")); await signIn(page,"ADMIN"); await page.goto(origin + "/admin/requests");
    await page.getByRole("button",{name:`Open request ${request.submissionId}`,exact:true}).click(); await page.getByRole("heading",{name:"Request details",exact:true}).waitFor();
    assert.match(await page.locator("main").innerText(),/\d+ new requests/);
    for (const width of [320,768,1024,1440]) { await page.setViewportSize({width,height:1000}); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),`Inbox fits ${width}px`); await screenshot(page,`requests-inbox-${width}`); }
    assert.deepEqual(errors,[]);
  } finally { await c.close(); }
});

test("denied refresh, detail and post-commit update responses remove protected request data without retries", {timeout:120000}, async () => {
  for (const operation of ["refresh401","detail403","save403","revoked"] as const) {
    const c = await context(); let mutations = 0;
    try {
      const privateMessage = "LOCAL PRIVATE SENTINEL " + token(), request = await apiRequest(c,"BESPOKE",{message:privateMessage}), page = await c.newPage();
      await signIn(page,"ADMIN"); await page.goto(origin + "/admin/requests");
      await page.getByRole("button",{name:`Open request ${request.submissionId}`,exact:true}).click(); await page.getByText(privateMessage,{exact:true}).waitFor();
      const endpoint = origin + `/api/admin/requests/BESPOKE/${request.submissionId}`;
      if (operation === "refresh401") await page.route(origin + "/api/admin/requests/search",(route: {fulfill(value:unknown):Promise<void>}) => route.fulfill({status:401,json:{message:"Access denied."}}));
      if (operation === "detail403") await page.route(endpoint,(route: {fulfill(value:unknown):Promise<void>}) => route.fulfill({status:403,json:{message:"Access denied."}}));
      if (operation === "save403") {
        await page.getByLabel("Update status",{exact:true}).selectOption("CONTACTED");
        await page.route(endpoint,async(route: { request(): { method(): string }; fetch():Promise<{status():number}>;fulfill(value:unknown):Promise<void>;continue():Promise<void>}) => {
          if (route.request().method() !== "POST") { await route.continue(); return; }
          mutations++; assert.equal((await route.fetch()).status(),200); await route.fulfill({status:403,json:{message:"Access changed after commit."}});
        });
        await adminPost(page,`/api/admin/requests/BESPOKE/${request.submissionId}`,"Save request update",403);
      } else if (operation === "detail403") await page.getByRole("button",{name:"Reload saved request",exact:true}).click();
      else {
        if (operation === "revoked") await fixture.data.query("DELETE FROM admin_auth_sessions WHERE user_id=$1",[fixture.users.ADMIN.id]);
        await adminPost(page,"/api/admin/requests/search","Refresh requests",401);
      }
      await page.locator("main").getByRole("alert").filter({hasText:"Private request access is unavailable"}).waitFor();
      assert.equal(await page.getByRole("heading",{name:"Request details",exact:true}).count(),0);
      assert.equal(await page.getByRole("button",{name:"Save request update",exact:true}).count(),0);
      assert.equal(await page.getByRole("button",{name:/Open request/}).count(),0);
      const visible = await page.locator("main").innerText(); assert.ok(!visible.includes(request.email!)); assert.ok(!visible.includes(privateMessage));
      await page.waitForTimeout(100); assert.equal(mutations,operation === "save403" ? 1 : 0);
      if (operation === "save403") assert.equal((await fixture.data.query("SELECT count(*) FROM audit_events WHERE action='REQUEST_UPDATED' AND target_id=$1",[request.submissionId])).rows[0].count,"1");
    } finally { await c.close(); }
  }
});

test("pagehide clears private request details and requires an explicit authorized refresh", async () => {
  const c = await context();
  try {
    const privateMessage = "LOCAL HIDDEN PRIVATE SENTINEL " + token(), request = await apiRequest(c,"BESPOKE",{message:privateMessage}), page = await c.newPage();
    await signIn(page,"ADMIN"); await page.goto(origin + "/admin/requests"); await page.getByRole("button",{name:`Open request ${request.submissionId}`,exact:true}).click(); await page.getByText(privateMessage,{exact:true}).waitFor();
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    await page.locator("main").getByRole("alert").filter({hasText:"Private request details were hidden"}).waitFor();
    assert.ok(!(await page.locator("main").innerText()).includes(privateMessage)); assert.equal(await page.getByRole("button",{name:/Open request/}).count(),0);
    await adminPost(page,"/api/admin/requests/search","Refresh requests");
    await page.getByRole("button",{name:`Open request ${request.submissionId}`,exact:true}).click(); await page.getByText(privateMessage,{exact:true}).waitFor();
  } finally { await c.close(); }
});

test("a piece unpublished after form load reports a definite rejection with an editable form and safe recovery link", async () => {
  const c = await context(); let attempts = 0;
  try {
    const page = await c.newPage(); await page.goto(origin + `/contact?intent=QUOTATION&product=dev-unique-ring&variant=${id(201)}`); await details(page);
    page.on("request",(request: {url():string;method():string}) => { if (request.url() === origin + "/api/requests" && request.method() === "POST") attempts++; });
    await fixture.data.query("UPDATE products SET status='DRAFT' WHERE id=$1",[id(101)]);
    const before = (await fixture.data.query("SELECT count(*) FROM product_enquiries")).rows[0].count;
    const response = await send(page,409); assert.ok((await response.json()).fieldErrors.productId);
    await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "alert");
    assert.match(await page.locator("main").getByRole("alert").innerText(),/No request was created/);
    assert.equal(await page.getByLabel("Your name (required)",{exact:true}).isEnabled(),true);
    assert.equal(await page.locator('textarea[name="message"]').inputValue(),"LOCAL TEST ONLY. Please discuss this synthetic request with the boutique.");
    assert.equal(await page.getByRole("link",{name:"Choose a published piece",exact:true}).getAttribute("href"),"/collections");
    assert.equal(await page.getByRole("button",{name:"Retry this same request",exact:true}).count(),0);
    await page.waitForTimeout(100); assert.equal(attempts,1); assert.equal((await fixture.data.query("SELECT count(*) FROM product_enquiries")).rows[0].count,before);
  } finally { await fixture.data.query("UPDATE products SET status='PUBLISHED' WHERE id=$1",[id(101)]); await c.close(); }
});
