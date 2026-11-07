import assert from "node:assert/strict";
import { before, beforeEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { adminBrowserHarness } from "./helpers/admin-browser.mts";
import type { EditorProduct } from "../src/lib/admin/catalogue/types.ts";

// Browser plugin not available. The existing HTTPS production-server harness
// uses a disposable loopback database and its authenticated media-provider mock.
process.env.COMMERCE_MODE = "QUOTATION_ONLY";
const h = adminBrowserHarness(true), { origin, signIn, screenshot } = h;
let browser: ReturnType<typeof h.current>["browser"], fixture: ReturnType<typeof h.current>["fixture"], photograph: Buffer;
type Page = Awaited<ReturnType<typeof browser.newPage>>;
type Context = Awaited<ReturnType<typeof browser.newContext>>;
before(async () => { photograph = await sharp("public/images/ring-emerald.png").resize(500,500,{fit:"contain",background:{r:255,g:255,b:255,alpha:0}}).png().toBuffer(); });
beforeEach(() => { ({browser,fixture} = h.current()); });
const token = () => randomUUID().slice(0,8);
const file = (name: string) => ({name:`local-ui-${name}.png`,mimeType:"image/png",buffer:photograph});
async function context(width = 1440): Promise<Context> {
  const c = await browser.newContext({ignoreHTTPSErrors:true,reducedMotion:"reduce",viewport:{width,height:1000}});
  c.setDefaultTimeout(15000); c.setDefaultNavigationTimeout(15000); return c;
}
async function post(page: Page, path: string, label: string) {
  const waiting = page.waitForResponse((response: {url():string;request():{method():string}}) => response.url() === origin + path && response.request().method() === "POST");
  await page.getByRole("button",{name:label,exact:true}).click(); const response=await waiting; assert.equal(response.status(),200); return response;
}
async function newProduct(page: Page, name: string) {
  await signIn(page,"CATALOGUE_MANAGER"); await page.goto(origin + "/admin/products/new"); await page.getByLabel("Jewelry Name",{exact:true}).fill(name);
}
const description = (page: Page, index: number) => page.getByLabel(`Description for selected photograph ${index}`,{exact:true});
const photoDetails = (page: Page, index: number) => description(page,index).locator("..").locator("..");
async function describe(page: Page, index: number, value: string) {
  const details=photoDetails(page,index);
  if (!await details.evaluate((element: HTMLDetailsElement) => element.open)) await details.locator("summary").click();
  await description(page,index).fill(value);
}
async function collapse(page: Page, index: number) {
  const details=photoDetails(page,index);
  if (await details.evaluate((element: HTMLDetailsElement) => element.open)) await details.locator("summary").click();
}
function mutations(page: Page) {
  const calls={product:0,photos:0};
  page.on("request",(request: {url():string;method():string}) => {
    if (request.method() !== "POST") return;
    if (/\/api\/admin\/catalogue\/products(?:\/[a-f0-9-]+\/save)?$/.test(request.url())) calls.product++;
    if (/\/api\/admin\/catalogue\/products\/[a-f0-9-]+\/photos$/.test(request.url())) calls.photos++;
  }); return calls;
}
async function rejectedDescription(page: Page, index: number, path: string, action = "Save Draft") {
  await page.getByRole("button",{name:action,exact:true}).click();
  await page.waitForFunction((path: string) => document.activeElement?.getAttribute("data-field-path") === path,path);
  const input=description(page,index);
  assert.equal(await input.getAttribute("data-field-path"),path); assert.equal(await input.getAttribute("aria-invalid"),"true");
  assert.equal(await photoDetails(page,index).evaluate((element: HTMLDetailsElement) => element.open),true,"The invalid photograph disclosure must open before focus.");
  assert.equal(await input.evaluate((element: HTMLInputElement) => { const ids=(element.getAttribute("aria-describedby") || "").split(/\s+/); return ids.some(id => /Leave the description blank, or use 5.*250/.test(document.getElementById(id)?.textContent || "")); }),true,"The selected photo must describe its associated length error.");
  assert.match(await page.locator("main").getByRole("alert").innerText(),/photographs remain selected/);
}
async function savedProduct(c: Context, page: Page): Promise<EditorProduct> {
  await page.getByRole("status").filter({hasText:"Product and selected photographs saved."}).waitFor();
  await page.waitForURL(/\/admin\/products\/[a-f0-9-]{36}\/edit$/);
  assert.equal(await page.getByRole("img",{name:/^Selected photograph /}).count(),0);
  const id=new URL(page.url()).pathname.split("/")[3], response=await c.request.get(origin + `/api/admin/catalogue/products/${id}`);
  assert.equal(response.status(),200); return (await response.json()).product;
}

test("both homepage catalogue calls to action navigate to the populated catalogue", async () => {
  const c=await context();
  try {
    const page=await c.newPage(), errors: string[]=[]; page.on("pageerror",() => errors.push("Page runtime error"));
    for (const label of ["Explore the Catalog","View Catalog"]) {
      await page.goto(origin + "/",{waitUntil:"networkidle"}); const link=page.getByRole("link",{name:label,exact:true}); assert.equal(await link.getAttribute("href"),"/collections");
      await link.click(); await page.waitForURL(origin + "/collections");
      assert.ok((await page.locator("h1").innerText()).trim().length); assert.equal(await page.getByRole("link",{name:"All jewelry",exact:true}).getAttribute("aria-current"),"page");
      assert.ok(await page.locator('a[href^="/jewels/"]').count(),"The destination must render catalogue pieces.");
      assert.equal(await page.locator("nextjs-portal").count(),0);
    }
    await screenshot(page,"functional-home-catalogue"); assert.deepEqual(errors,[]);
  } finally { await c.close(); }
});

test("Escape closes the mobile navigation and returns focus to its toggle", async () => {
  const c=await context(320);
  try {
    const page=await c.newPage(); await page.goto(origin + "/",{waitUntil:"networkidle"});
    const toggle=page.getByRole("button",{name:"Open menu",exact:true}); await toggle.click();
    const panel=page.getByRole("navigation",{name:"Site sections",exact:true}); await panel.getByRole("link",{name:"Collections",exact:true}).focus(); await page.keyboard.press("Escape");
    assert.equal(await toggle.getAttribute("aria-expanded"),"false"); assert.equal(await toggle.evaluate((element: HTMLElement) => element === document.activeElement),true); assert.equal(await panel.isVisible(),false);
    assert.equal(await page.evaluate(() => document.body.style.overflow === "hidden"),false);
    await screenshot(page,"functional-mobile-menu-escape");
  } finally { await c.close(); }
});

test("category and collection name fields have distinct accessible names and save independently", async () => {
  const c=await context();
  try {
    const page=await c.newPage(); await signIn(page,"CATALOGUE_MANAGER"); await page.goto(origin + "/admin/taxonomy");
    await page.getByLabel("Choose category",{exact:true}).selectOption(""); await page.getByLabel("Choose collection",{exact:true}).selectOption("");
    const category=page.getByRole("textbox",{name:"Category name",exact:true}), collection=page.getByRole("textbox",{name:"Collection name",exact:true});
    assert.equal(await category.count(),1); assert.equal(await collection.count(),1); assert.equal(await page.getByRole("textbox",{name:"Name",exact:true}).count(),0);
    const categoryName=`LOCAL DISTINCT CATEGORY ${token()}`, collectionName=`LOCAL DISTINCT COLLECTION ${token()}`;
    await category.fill(categoryName); await collection.fill(collectionName); const categoryResult=await (await post(page,"/api/admin/catalogue/taxonomy","Create category")).json();
    await page.getByRole("status").filter({hasText:"Category saved."}).waitFor(); assert.equal(await collection.inputValue(),collectionName);
    const collectionResult=await (await post(page,"/api/admin/catalogue/taxonomy","Create collection")).json(); await page.getByRole("status").filter({hasText:"Collection saved."}).waitFor(); assert.equal(await category.inputValue(),categoryName);
    assert.equal((await fixture.data.query("SELECT name FROM categories WHERE id=$1",[categoryResult.id])).rows[0].name,categoryName); assert.equal((await fixture.data.query("SELECT name FROM collections WHERE id=$1",[collectionResult.id])).rows[0].name,collectionName);
  } finally { await c.close(); }
});

test("one-to-four-character selected photo descriptions block saving locally and preserve the same file until a valid description uploads once", async () => {
  const c=await context();
  try {
    const page=await c.newPage(), name=`LOCAL SHORT PHOTO ${token()}`; await newProduct(page,name); const calls=mutations(page);
    await page.getByLabel("Add Photographs",{exact:true}).setInputFiles(file("same-queued-file"));
    const image=page.getByRole("img",{name:"Selected photograph 1: local-ui-same-queued-file.png",exact:true}), preview=await image.getAttribute("src"), path=(await description(page,1).getAttribute("data-field-path"))!;
    assert.match(path,/^selectedPhotos\.[a-f0-9-]{36}\.altText$/);
    for (const value of ["a","ab","abc","abcd"]) {
      await describe(page,1,value); await collapse(page,1); await rejectedDescription(page,1,path);
      assert.equal(await description(page,1).inputValue(),value); assert.equal(await image.getAttribute("src"),preview); assert.equal(await page.getByRole("heading",{name:"Selected on this device (1)",exact:true}).count(),1); assert.deepEqual(calls,{product:0,photos:0});
      assert.equal((await fixture.data.query("SELECT count(*) FROM products WHERE name=$1",[name])).rows[0].count,"0");
    }
    await description(page,1).fill("Front"); await post(page,"/api/admin/catalogue/products","Save Draft"); const saved=await savedProduct(c,page);
    assert.deepEqual(calls,{product:1,photos:1}); assert.equal(saved.name,name); assert.equal(saved.media.length,1); assert.equal(saved.media[0].altText,"Front");
  } finally { await c.close(); }
});

test("blank selected photo descriptions keep the jewelry-name fallback and upload each selected file once", async () => {
  const c=await context();
  try {
    const page=await c.newPage(), name=`LOCAL BLANK PHOTO ${token()}`; await newProduct(page,name); const calls=mutations(page);
    await page.getByLabel("Add Photographs",{exact:true}).setInputFiles([file("blank"),file("whitespace")]); await describe(page,2,"   ");
    await post(page,"/api/admin/catalogue/products","Save Draft"); const saved=await savedProduct(c,page);
    assert.deepEqual(calls,{product:1,photos:2}); assert.deepEqual(saved.media.map(photo => photo.altText),[`${name} — photograph 1`,`${name} — photograph 2`]);
  } finally { await c.close(); }
});

test("multiple queued photos focus the first invalid UUID and retain the correct target after a queue index changes", async () => {
  const c=await context();
  try {
    const page=await c.newPage(), name=`LOCAL MULTIPLE PHOTO ${token()}`; await newProduct(page,name); const calls=mutations(page);
    await page.getByLabel("Add Photographs",{exact:true}).setInputFiles([file("first"),file("second"),file("third")]);
    await describe(page,1,"First view"); await describe(page,2,"bad"); await describe(page,3,"tiny");
    const secondPath=(await description(page,2).getAttribute("data-field-path"))!, thirdPath=(await description(page,3).getAttribute("data-field-path"))!;
    assert.notEqual(secondPath,thirdPath); for (const index of [1,2,3]) await collapse(page,index); await rejectedDescription(page,2,secondPath); assert.deepEqual(calls,{product:0,photos:0});
    await page.getByRole("button",{name:"Remove selected photograph 1",exact:true}).click();
    assert.equal(await description(page,1).getAttribute("data-field-path"),secondPath); await description(page,1).fill("Second view"); await collapse(page,1); await rejectedDescription(page,2,thirdPath);
    assert.equal(await page.getByRole("heading",{name:"Selected on this device (2)",exact:true}).count(),1); assert.deepEqual(calls,{product:0,photos:0});
    await description(page,2).fill("Third view"); await post(page,"/api/admin/catalogue/products","Save Draft"); const saved=await savedProduct(c,page);
    assert.deepEqual(calls,{product:1,photos:2}); assert.deepEqual(saved.media.map(photo => photo.altText),["Second view","Third view"]);
  } finally { await c.close(); }
});

test("uploading to a saved draft also rejects short descriptions locally and uploads the retained file once after correction", async () => {
  const c=await context();
  try {
    const page=await c.newPage(), name=`LOCAL SAVED PHOTO ${token()}`; await newProduct(page,name); const created=await (await post(page,"/api/admin/catalogue/products","Save Draft")).json(); await page.waitForURL(origin + `/admin/products/${created.id}/edit`);
    const calls=mutations(page); await page.getByLabel("Add Photographs",{exact:true}).setInputFiles(file("retained-existing-draft")); await describe(page,1,"four"); await collapse(page,1);
    const path=(await description(page,1).getAttribute("data-field-path"))!; await rejectedDescription(page,1,path,"Upload selected photographs"); assert.deepEqual(calls,{product:0,photos:0});
    await description(page,1).fill("Front view"); await post(page,`/api/admin/catalogue/products/${created.id}/photos`,"Upload selected photographs"); const saved=await savedProduct(c,page);
    assert.deepEqual(calls,{product:0,photos:1}); assert.equal(saved.media.length,1); assert.equal(saved.media[0].altText,"Front view");
  } finally { await c.close(); }
});
