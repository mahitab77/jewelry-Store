import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import { adminBrowserHarness } from "./helpers/admin-browser.mts";
import type { PublicRequestInput, RequestKind } from "../src/lib/requests/types.ts";

// Browser plugin not available. Use the existing local HTTPS production-server
// Playwright harness so focus, scrolling and protected responses are exercised.
process.env.COMMERCE_MODE = "QUOTATION_ONLY";
const h = adminBrowserHarness(true,false,false,false,{ requests: true });
const { origin, signIn, screenshot } = h;
let browser: ReturnType<typeof h.current>["browser"], fixture: ReturnType<typeof h.current>["fixture"];
type Page = Awaited<ReturnType<typeof browser.newPage>>;
type Context = Awaited<ReturnType<typeof browser.newContext>>;
beforeEach(() => { ({ browser,fixture } = h.current()); });
const searchPath = "/api/admin/requests/search";
const token = () => randomUUID().slice(0,8);
async function context(): Promise<Context> {
  const c = await browser.newContext({ ignoreHTTPSErrors: true, reducedMotion: "reduce", viewport: { width:1440,height:1000 }, timezoneId:"America/Los_Angeles" });
  c.setDefaultTimeout(15000); c.setDefaultNavigationTimeout(15000); return c;
}
async function createRequest(c: Context, kind: RequestKind, extra: Partial<PublicRequestInput> = {}) {
  const unique = token(), input: PublicRequestInput = { submissionId:randomUUID(),kind,name:`LOCAL UX CUSTOMER ${unique}`,email:`inbox-ux-${unique}@boutique.test`,message:`LOCAL UX PRIVATE MESSAGE ${unique}`,...extra };
  const response = await c.request.post(origin + "/api/requests",{headers:{Origin:origin},data:input}); assert.equal(response.status(),200); return input;
}
async function enterInbox(page: Page) {
  await signIn(page,"OWNER"); await page.getByRole("link",{name:"Manage boutique requests",exact:true}).click();
  await page.getByRole("button",{name:/^Open request /}).first().waitFor();
}
async function openRequest(page: Page, reference: string) {
  await page.getByRole("button",{name:`Open request ${reference}`,exact:true}).click();
  await page.waitForFunction(() => document.activeElement?.id === "request-details-title");
  assert.equal(await page.getByRole("heading",{name:"Request details",exact:true}).getAttribute("tabindex"),"-1");
  await inViewport(page,"#request-details-title");
}
async function post(page: Page, path: string, button: string, expected = 200) {
  const waiting = page.waitForResponse((response: {url():string;request():{method():string}}) => response.url() === origin + path && response.request().method() === "POST");
  await page.getByRole("button",{name:button,exact:true}).click(); const response = await waiting; assert.equal(response.status(),expected); return response;
}
async function inViewport(page: Page, selector: string) {
  assert.equal(await page.locator(selector).evaluate((element: HTMLElement) => { const rect = element.getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= innerHeight; }),true,"The focused target must be visible in the viewport.");
}
async function localFeedbackFocused(page: Page, role: "status" | "alert", text: string) {
  const notice = page.getByRole("region",{name:"Request details",exact:true}).getByRole(role).filter({hasText:text});
  await notice.waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "status" || document.activeElement?.getAttribute("role") === "alert");
  assert.equal(await notice.evaluate((element: HTMLElement) => element === document.activeElement),true,"Save feedback must receive focus inside the loaded request.");
  assert.equal(await notice.evaluate((element: HTMLElement) => { const rect=element.getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= innerHeight; }),true);
}

test("opening a request below a full twenty-row inbox reveals and focuses details; refresh does not refocus details and save uses local feedback", {timeout:90000}, async () => {
  const c = await context();
  try {
    const unique = token(), records = Array.from({length:20},(_,index) => ({id:randomUUID(),name:`LOCAL FULL INBOX ${unique} ${index}`,email:`full-${unique}-${index}@boutique.test`,message:`LOCAL FULL INBOX MESSAGE ${unique} ${index}`}));
    await fixture.data.query("INSERT INTO bespoke_requests(id,contact_name,contact_email,message,status) SELECT id::uuid,name,email,message,'IN_DESIGN' FROM jsonb_to_recordset($1::jsonb) AS r(id TEXT,name TEXT,email TEXT,message TEXT)",[JSON.stringify(records)]);
    const page = await c.newPage(), errors: string[] = []; page.on("pageerror",() => errors.push("Page runtime error"));
    await enterInbox(page); await page.getByLabel("Request type",{exact:true}).selectOption("BESPOKE"); await page.getByLabel("Request status",{exact:true}).selectOption("IN_DESIGN"); await post(page,searchPath,"Refresh requests");
    assert.equal(await page.getByRole("button",{name:/^Open request /}).count(),20);
    for (const width of [1440,320]) {
      await page.setViewportSize({width,height:1000}); await openRequest(page,records[0].id);
      assert.equal(await page.getByRole("region",{name:"Request details",exact:true}).getByText(records[0].message,{exact:true}).count(),1);
      await screenshot(page,`request-inbox-open-${width}`);
      await post(page,searchPath,"Refresh requests");
      assert.equal(await page.getByRole("heading",{name:"Request details",exact:true}).evaluate((element: HTMLElement) => element === document.activeElement),false,"An unrelated list refresh must not move focus to the loaded details.");
      assert.equal(await page.getByRole("button",{name:"Refresh requests",exact:true}).evaluate((element: HTMLElement) => { const rect=element.getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= innerHeight; }),true,"Refreshing the list must not scroll away from its control.");
      assert.equal(await page.getByRole("heading",{name:"Request details",exact:true}).count(),1);
    }
    await page.getByLabel("Update status",{exact:true}).selectOption("QUOTED"); await post(page,`/api/admin/requests/BESPOKE/${records[0].id}`,"Save request update");
    await localFeedbackFocused(page,"status","Request updated.");
    assert.equal(await page.getByRole("button",{name:/^Open request /}).count(),20);
    assert.deepEqual(errors,[]);
  } finally { await c.close(); }
});

test("a real Cairo DST gap rejects confirmation at its time field and a corrected confirmation succeeds without losing the request", async () => {
  const c = await context();
  try {
    const request = await createRequest(c,"CONSULTATION",{channel:"ZOOM"}), page = await c.newPage(); await enterInbox(page); await openRequest(page,request.submissionId);
    await page.getByLabel("Update status",{exact:true}).selectOption("CONFIRMED"); await page.getByLabel("Confirmed date (Africa/Cairo)",{exact:true}).fill("2027-04-30"); await page.getByLabel("Confirmed time (Africa/Cairo)",{exact:true}).fill("00:30"); await page.getByLabel("I have agreed these arrangements personally with the customer",{exact:true}).check();
    const rejected = await post(page,`/api/admin/requests/CONSULTATION/${request.submissionId}`,"Save request update",400); assert.match((await rejected.json()).fieldErrors.confirmedTime,/clocks change/);
    const time = page.getByLabel("Confirmed time (Africa/Cairo)",{exact:true});
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Confirmed time (Africa/Cairo)");
    assert.equal(await time.getAttribute("aria-invalid"),"true"); assert.equal(await time.getAttribute("aria-describedby"),"request-update-confirmedTime-error");
    assert.match(await page.locator("#request-update-confirmedTime-error").innerText(),/clocks change/); await inViewport(page,'input[aria-label="Confirmed time (Africa/Cairo)"]');
    assert.equal(await page.getByRole("region",{name:"Request details",exact:true}).getByText(request.email!,{exact:true}).count(),1);
    assert.equal((await fixture.data.query("SELECT count(*) FROM audit_events WHERE action='REQUEST_UPDATED' AND target_id=$1",[request.submissionId])).rows[0].count,"0");
    await time.fill("01:30"); await post(page,`/api/admin/requests/CONSULTATION/${request.submissionId}`,"Save request update"); await localFeedbackFocused(page,"status","Request updated.");
    assert.equal(await time.getAttribute("aria-invalid"),null); assert.equal(await time.getAttribute("aria-describedby"),null);
    const saved = (await fixture.data.query("SELECT status,confirmed_start_at::TEXT FROM appointment_requests WHERE id=$1",[request.submissionId])).rows[0]; assert.equal(saved.status,"CONFIRMED"); assert.match(saved.confirmed_start_at,/2027-04-29 22:30:00/);
    assert.equal((await fixture.data.query("SELECT count(*) FROM audit_events WHERE action='REQUEST_UPDATED' AND target_id=$1",[request.submissionId])).rows[0].count,"1");
  } finally { await c.close(); }
});

test("assignee cards and controls distinguish assigned, unassigned and disabled staff and require deliberate valid reassignment", async () => {
  const c = await context();
  try {
    const active = await createRequest(c,"BESPOKE"), unassigned = await createRequest(c,"BESPOKE"), unavailable = await createRequest(c,"BESPOKE");
    await fixture.data.query("UPDATE bespoke_requests SET assigned_admin_id=$2 WHERE id=$1",[active.submissionId,fixture.users.OWNER.id]);
    await fixture.data.query("UPDATE bespoke_requests SET assigned_admin_id=$2 WHERE id=$1",[unavailable.submissionId,fixture.users.ADMIN.id]); await fixture.data.query("UPDATE admin_users SET is_active=false WHERE id=$1",[fixture.users.ADMIN.id]);
    const page = await c.newPage(); await enterInbox(page);
    const card = (reference: string) => page.locator("article").filter({has:page.getByRole("button",{name:`Open request ${reference}`,exact:true})});
    assert.match(await card(active.submissionId).innerText(),/Assigned to: Fixture OWNER/); assert.match(await card(unassigned.submissionId).innerText(),/Assigned to: Unassigned/); assert.match(await card(unavailable.submissionId).innerText(),/Assigned to: Fixture ADMIN \(unavailable\)/);
    await openRequest(page,unassigned.submissionId); assert.equal(await page.getByLabel("Assigned employee",{exact:true}).inputValue(),"");
    await openRequest(page,active.submissionId); assert.equal(await page.getByLabel("Assigned employee",{exact:true}).inputValue(),fixture.users.OWNER.id);
    await openRequest(page,unavailable.submissionId); const employee = page.getByLabel("Assigned employee",{exact:true});
    assert.equal(await employee.inputValue(),fixture.users.ADMIN.id); assert.equal(await employee.locator("option:checked").innerText(),"Fixture ADMIN (unavailable)");
    // Playwright's isDisabled follows the enclosing label back to its enabled
    // select. Inspect the selected option itself, which must remain disabled.
    assert.equal(await employee.locator("option:checked").evaluate((option: HTMLOptionElement) => option.disabled),true);
    await post(page,`/api/admin/requests/BESPOKE/${unavailable.submissionId}`,"Save request update",400);
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Assigned employee"); assert.equal(await employee.getAttribute("aria-invalid"),"true"); assert.equal(await employee.getAttribute("aria-describedby"),"request-update-assignedAdminId-error");
    assert.equal((await fixture.data.query("SELECT assigned_admin_id FROM bespoke_requests WHERE id=$1",[unavailable.submissionId])).rows[0].assigned_admin_id,fixture.users.ADMIN.id);
    await employee.selectOption(fixture.users.OWNER.id); await post(page,`/api/admin/requests/BESPOKE/${unavailable.submissionId}`,"Save request update"); await localFeedbackFocused(page,"status","Request updated."); assert.match(await card(unavailable.submissionId).innerText(),/Assigned to: Fixture OWNER/);
    await employee.selectOption(""); await post(page,`/api/admin/requests/BESPOKE/${unavailable.submissionId}`,"Save request update"); await localFeedbackFocused(page,"status","Request updated."); assert.match(await card(unavailable.submissionId).innerText(),/Assigned to: Unassigned/);
    assert.equal((await fixture.data.query("SELECT assigned_admin_id FROM bespoke_requests WHERE id=$1",[unavailable.submissionId])).rows[0].assigned_admin_id,null);
    assert.equal((await fixture.data.query("SELECT count(*) FROM audit_events WHERE action='REQUEST_UPDATED' AND target_id=$1",[unavailable.submissionId])).rows[0].count,"2");
  } finally { await fixture.data.query("UPDATE admin_users SET is_active=true WHERE id=$1",[fixture.users.ADMIN.id]); await c.close(); }
});

test("completed and cancelled boutique consultations retain an inactive location reference outside the active confirmation choices", async () => {
  const c = await context();
  try {
    const location = randomUUID(), locationName = `LOCAL RETAINED BOUTIQUE ${token()}`;
    await fixture.data.query("INSERT INTO boutique_locations(id,name,governorate,city_area,street_address,is_active) VALUES($1,$2,'Cairo','Local area','Current fixture street',false)",[location,locationName]);
    const completed = await createRequest(c,"CONSULTATION",{channel:"BOUTIQUE"}), cancelled = await createRequest(c,"CONSULTATION",{channel:"BOUTIQUE"});
    for (const [request,status] of [[completed,"COMPLETED"],[cancelled,"CANCELLED"]] as const) await fixture.data.query("UPDATE appointment_requests SET status=$2,confirmed_start_at='2030-01-15T12:30:00Z',boutique_location_id=$3 WHERE id=$1",[request.submissionId,status,location]);
    const page = await c.newPage(); await enterInbox(page);
    for (const request of [completed,cancelled]) {
      await openRequest(page,request.submissionId); const details = page.getByRole("region",{name:"Request details",exact:true});
      assert.equal(await details.getByText("Retained boutique location",{exact:true}).count(),1); assert.match(await details.innerText(),new RegExp(`${locationName} · Reference: ${location} · Inactive`));
      assert.equal(await page.getByLabel("Verified boutique location",{exact:true}).count(),0);
      const saved = await c.request.get(origin + `/api/admin/requests/CONSULTATION/${request.submissionId}`); assert.equal(saved.status(),200); const result = await saved.json(); assert.equal(result.request.boutiqueLocation.id,location); assert.equal(result.request.boutiqueLocation.isActive,false); assert.equal(result.locations.some((choice: {id:string}) => choice.id === location),false);
    }
  } finally { await c.close(); }
});

test("known revision and rate-limit rejections keep local edits and focus local feedback without retrying writes", async () => {
  const c = await context();
  try {
    const request = await createRequest(c,"BESPOKE"), page = await c.newPage(); await enterInbox(page); await openRequest(page,request.submissionId);
    await page.getByLabel("Update status",{exact:true}).selectOption("CONTACTED"); await fixture.data.query("UPDATE bespoke_requests SET updated_at=updated_at+INTERVAL '1 second' WHERE id=$1",[request.submissionId]);
    const endpoint = `/api/admin/requests/BESPOKE/${request.submissionId}`; await post(page,endpoint,"Save request update",409); await localFeedbackFocused(page,"alert","This request changed.");
    assert.equal(await page.getByLabel("Update status",{exact:true}).inputValue(),"CONTACTED"); assert.equal(await page.getByRole("button",{name:"Save request update",exact:true}).isEnabled(),true);
    let attempts = 0;
    await page.route(origin + endpoint,async(route: {request():{method():string};fulfill(value:unknown):Promise<void>;continue():Promise<void>}) => { if (route.request().method() !== "POST") { await route.continue(); return; } attempts++; await route.fulfill({status:429,json:{message:"Synthetic rate limit. Wait before saving again."}}); });
    await post(page,endpoint,"Save request update",429); await localFeedbackFocused(page,"alert","Synthetic rate limit."); assert.equal(await page.getByLabel("Update status",{exact:true}).inputValue(),"CONTACTED");
    assert.equal(attempts,1); assert.equal((await fixture.data.query("SELECT count(*) FROM audit_events WHERE action='REQUEST_UPDATED' AND target_id=$1",[request.submissionId])).rows[0].count,"0");
  } finally { await c.close(); }
});
