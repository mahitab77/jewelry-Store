import assert from 'node:assert/strict';
import { beforeEach,test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { adminBrowserHarness } from './helpers/admin-browser.mts';
import { deliveryDetails,checkoutContact,testLocation } from './helpers/checkout-data.mts';
import { signedTransaction,transactionFixture } from './helpers/paymob-mock.mts';
import { developmentId as id } from '../db/tools/seed.ts';
import type { CheckoutDetails } from '../src/lib/checkout/types.ts';

const harness=adminBrowserHarness(false,true,true),{origin,screenshot}=harness;
let browser:ReturnType<typeof harness.current>['browser'],f:ReturnType<typeof harness.current>['fixture'];
beforeEach(async()=>{
  ({browser,fixture:f}=harness.current());
  // Each prior flow resolves its hold; only fixture catalogue availability resets.
  await f.data.query("UPDATE products SET status='PUBLISHED',published_at='2020-01-01' WHERE id=ANY($1::UUID[])",[[id(101),id(102)]]);
  await f.data.query('UPDATE inventory SET on_hand=CASE variant_id WHEN $1 THEN 5 ELSE 1 END WHERE variant_id=ANY($2::UUID[])',[id(202),[id(201),id(202)]]);
  await f.data.query('UPDATE boutique_locations SET is_active=false');
  for(const value of [checkoutContact.fullName,checkoutContact.email,checkoutContact.phone,deliveryDetails().street,deliveryDetails().instructions])harness.trackSecret(value);
});
type Page=Awaited<ReturnType<typeof browser.newPage>>;
type Context=Awaited<ReturnType<typeof browser.newContext>>;
async function start(context:Context,variant=id(202)){
  const added=await context.request.post(origin+'/api/cart/items',{headers:{Origin:origin},data:{variantId:variant,quantity:1}});assert.equal(added.status(),200);
  const cookie=(await context.cookies()).find((c:{name:string})=>c.name==='__Host-la-palme-bag');assert.ok(cookie);harness.trackSecret(cookie.value);assert.equal(cookie.httpOnly,true);assert.equal(cookie.secure,true);return cookie.value;
}
async function save(context:Context,extra:Partial<CheckoutDetails>={}){
  const view=(await(await context.request.get(origin+'/api/checkout')).json()).checkout;
  const response=await context.request.post(origin+'/api/checkout/draft',{headers:{Origin:origin},data:{details:{...deliveryDetails(),...extra},fingerprint:view.fingerprint,draftRevision:view.draft?.revision??null}});assert.equal(response.status(),200);return(await response.json()).checkout;
}
async function initiate(context:Context){
  const view=(await(await context.request.get(origin+'/api/checkout')).json()).checkout;
  return context.request.post(origin+'/api/payments/initiate',{headers:{Origin:origin},data:{fingerprint:view.fingerprint,draftRevision:view.draft?.revision??null}});
}
async function notify(context:Context,reference:string,extra:Record<string,unknown>={}){
  const p=(await f.data.query('SELECT * FROM payments WHERE order_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',[reference])).rows[0];
  const signed=signedTransaction(transactionFixture(p.provider_order_reference,Number(p.amount_minor),{id:Number(p.provider_order_reference)+400000000,...extra}));
  const response=await context.request.post(origin+'/api/payments/paymob/callback?hmac='+signed.signature,{data:signed.body});assert.equal(response.status(),200);
}
async function refresh(page:Page,reference:string){
  const response=page.waitForResponse((r:{url():string})=>r.url()===origin+'/api/orders/'+reference);await page.getByRole('button',{name:'Refresh order status',exact:true}).click();assert.equal((await response).status(),200);
}
async function healthy(page:Page){
  assert.match(await page.title(),/Order Status|Checkout Preparation/);assert.equal(await page.locator('h1').count(),1);assert.equal(await page.locator('nextjs-portal').count(),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.equal(await page.evaluate(()=>document.cookie.includes('la-palme-bag')),false);assert.deepEqual(await page.evaluate(()=>[Object.keys(localStorage),Object.keys(sessionStorage)]),[[],[]]);
}
async function mockHosted(page:Page){
  await page.route('https://eg.checkout.paymob.com/**',async(route:{request():{url():string;headers():Record<string,string>};fulfill(value:{contentType:string;body:string}):Promise<void>})=>{
    const request=route.request(),url=new URL(request.url());assert.equal(url.origin,'https://eg.checkout.paymob.com');assert.equal(request.headers().referer,undefined);assert.ok(!(request.headers().cookie??'').includes('la-palme-bag'));
    const row=(await f.data.query('SELECT order_id FROM payments WHERE checkout_client_secret=$1',[url.searchParams.get('clientSecret')])).rows[0];assert.ok(row);
    await route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><title>Mock Paymob checkout</title></head><body><h1>Mock hosted test checkout</h1><p>No provider transaction occurred.</p><a href="${origin}/api/payments/paymob/return/${row.order_id}?success=true&hmac=forged">Return to boutique</a></body></html>`});
  });
}
async function returnFromHosted(page:Page){await page.waitForURL('https://eg.checkout.paymob.com/**');await page.getByRole('heading',{name:'Mock hosted test checkout'}).waitFor();await page.getByRole('link',{name:'Return to boutique'}).click();await page.waitForURL(origin+'/orders/*');return new URL(page.url()).pathname.split('/').pop()!;}
async function fillReview(page:Page){
  await page.goto(origin+'/checkout',{waitUntil:'networkidle'});await page.getByLabel('Full name',{exact:true}).fill(checkoutContact.fullName);await page.getByLabel('Email address',{exact:true}).fill(checkoutContact.email);await page.getByLabel('Egyptian mobile number',{exact:true}).fill(checkoutContact.phone);
  await page.getByRole('radio',{name:'Private Delivery',exact:true}).check();await page.getByLabel('Governorate',{exact:true}).selectOption('Cairo');await page.getByLabel('City or area',{exact:true}).fill(deliveryDetails().city);await page.getByLabel('Street address',{exact:true}).fill(deliveryDetails().street);
  const saved=page.waitForResponse((r:{url():string})=>r.url()===origin+'/api/checkout/draft');await page.getByRole('button',{name:'Save draft',exact:true}).click();assert.equal((await saved).status(),200);await page.getByRole('heading',{name:'Ready for review',exact:true}).waitFor();
}

test('desktop checkout redirects only to mocked official hosted checkout and waits for verified server payment',async()=>{
  const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  try{
    const token=await start(context),page=await context.newPage(),errors:string[]=[];page.on('pageerror',(e:Error)=>errors.push(e.message));page.on('console',(m:{type():string;text():string})=>{if(['error','warning'].includes(m.type()))errors.push(m.text());});
    await mockHosted(page);await fillReview(page);await healthy(page);await screenshot(page,'payment-checkout-desktop');
    await page.getByRole('button',{name:'Proceed to Secure Payment',exact:true}).click();const reference=await returnFromHosted(page);
    await page.getByRole('heading',{name:'Awaiting payment confirmation',exact:true}).waitFor();await healthy(page);await screenshot(page,'payment-pending-desktop');
    assert.equal((await f.data.query('SELECT payment_status FROM orders WHERE id=$1',[reference])).rows[0].payment_status,'PENDING');
    await notify(context,reference);await refresh(page,reference);await page.getByRole('heading',{name:'Test payment received',exact:true}).waitFor();await healthy(page);await screenshot(page,'payment-paid-desktop');
    assert.equal((await f.data.query('SELECT fulfillment_status FROM orders WHERE id=$1',[reference])).rows[0].fulfillment_status,'UNARRANGED');assert.equal((await context.cookies()).find((c:{name:string})=>c.name==='__Host-la-palme-bag')!.value,token);
    await page.getByRole('link',{name:'Return to your bag',exact:true}).click();await page.getByRole('heading',{name:'Your shopping bag',exact:true}).waitFor();await page.getByRole('heading',{name:'Your bag is waiting',exact:true}).waitFor();assert.deepEqual(errors,[]);
  }finally{await context.close();}
});
test('mobile keyboard checkout supports failed payment and a safe retry of the same order',async()=>{
  const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:390,height:844},reducedMotion:'reduce'});
  try{
    await start(context);const page=await context.newPage();await mockHosted(page);await fillReview(page);const button=page.getByRole('button',{name:'Proceed to Secure Payment',exact:true});await button.focus();await page.keyboard.press('Enter');const reference=await returnFromHosted(page);
    await notify(context,reference,{success:false,error_occured:true});await refresh(page,reference);await page.getByRole('heading',{name:'Test payment unsuccessful',exact:true}).waitFor();await healthy(page);await screenshot(page,'payment-failed-mobile');
    await page.getByRole('button',{name:'Retry Test Payment',exact:true}).focus();await page.keyboard.press('Enter');assert.equal(await returnFromHosted(page),reference);
    await notify(context,reference);await refresh(page,reference);await page.getByRole('heading',{name:'Test payment received',exact:true}).waitFor();await healthy(page);await screenshot(page,'payment-paid-mobile');assert.equal((await f.data.query('SELECT count(*) FROM payments WHERE order_id=$1',[reference])).rows[0].count,'2');
  }finally{await context.close();}
});
test('concurrent HTTP submissions share one attempt and order status rejects a different guest',async()=>{
  const a=await browser.newContext({ignoreHTTPSErrors:true}),b=await browser.newContext({ignoreHTTPSErrors:true});
  try{
    await start(a);await save(a);const responses=await Promise.all([initiate(a),initiate(a)]),bodies=await Promise.all(responses.map(r=>r.json()));assert.ok(responses.every(r=>r.status()===200));assert.equal(bodies[0].orderReference,bodies[1].orderReference);const reference=bodies[0].orderReference;
    assert.equal((await f.data.query('SELECT count(*) FROM payments WHERE order_id=$1',[reference])).rows[0].count,'1');await start(b);const foreign=await b.request.get(origin+'/api/orders/'+reference);assert.equal(foreign.status(),404);
    // Order status polls. Its explicit denial state proves privacy without waiting for idle traffic.
    const page=await b.newPage();await page.goto(origin+'/orders/'+reference,{waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:'Order unavailable',exact:true}).waitFor();assert.ok(!(await page.locator('main').innerText()).includes(checkoutContact.email));
    await page.goto(origin+'/orders/'+randomUUID(),{waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:'Order unavailable',exact:true}).waitFor();await notify(a,reference,{success:false,error_occured:true});
  }finally{await a.close();await b.close();}
});
test('cart edits made in another tab survive verified payment and retain the correct bag count',async()=>{
  const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  try{
    await start(context);await save(context);const result=await(await initiate(context)).json(),reference=result.orderReference,page=await context.newPage();await page.goto(origin+result.orderUrl,{waitUntil:'networkidle'});
    const other=await context.newPage();await other.goto(origin+'/cart',{waitUntil:'networkidle'});const changed=other.waitForResponse((r:{url():string;request():{method():string}})=>r.url().includes('/api/cart/items/')&&r.request().method()==='PATCH');await other.getByRole('button',{name:/Increase quantity for/}).click();assert.equal((await changed).status(),200);
    assert.equal((await context.request.post(origin+'/api/cart/items',{headers:{Origin:origin},data:{variantId:id(201),quantity:1}})).status(),200);
    await notify(context,reference);await page.bringToFront();await refresh(page,reference);await page.getByRole('heading',{name:'Test payment received',exact:true}).waitFor();await other.bringToFront();await other.reload({waitUntil:'networkidle'});
    await other.getByRole('link',{name:'Shopping bag, 3 items',exact:true}).waitFor();assert.equal(await other.getByRole('spinbutton',{name:/Quantity for/}).count(),2);const cart=(await(await context.request.get(origin+'/api/cart')).json()).cart;assert.equal(cart.count,3);
  }finally{await context.close();}
});
test('late success is visibly held for review and cannot consume another guest unique-jewel reservation',async()=>{
  const a=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:390,height:844},reducedMotion:'reduce'}),b=await browser.newContext({ignoreHTTPSErrors:true});
  try{
    await start(a,id(201));await save(a);const first=await(await initiate(a)).json();await notify(a,first.orderReference,{success:false,error_occured:true});await start(b,id(201));await save(b);const second=await(await initiate(b)).json();
    await notify(a,first.orderReference);const page=await a.newPage();await page.goto(origin+first.orderUrl,{waitUntil:'networkidle'});await page.getByRole('heading',{name:'Payment needs review',exact:true}).waitFor();await healthy(page);assert.equal(await page.getByRole('button',{name:/Retry Test Payment|Continue to Secure Payment/}).count(),0);await screenshot(page,'payment-review-mobile');
    assert.deepEqual((await f.data.query('SELECT on_hand,reserved FROM inventory WHERE variant_id=$1',[id(201)])).rows[0],{on_hand:1,reserved:1});await notify(b,second.orderReference);
    assert.deepEqual((await f.data.query('SELECT on_hand,reserved FROM inventory WHERE variant_id=$1',[id(201)])).rows[0],{on_hand:0,reserved:0});
  }finally{await a.close();await b.close();}
});
test('collection payment preserves its immutable location and leaves all arrangements unscheduled',async()=>{
  const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  try{
    const location=(await f.data.query('INSERT INTO boutique_locations(name,governorate,city_area,street_address,is_active) VALUES($1,$2,$3,$4,true) RETURNING id',[testLocation.name,testLocation.governorate,testLocation.city,testLocation.street])).rows[0];
    await start(context);await save(context,{method:'BOUTIQUE_COLLECTION',locationId:location.id});const result=await(await initiate(context)).json();await notify(context,result.orderReference);
    await f.data.query("UPDATE boutique_locations SET street_address='TEST ONLY changed location address' WHERE id=$1",[location.id]);const page=await context.newPage();await page.goto(origin+result.orderUrl,{waitUntil:'networkidle'});await page.getByRole('heading',{name:'Test payment received',exact:true}).waitFor();await healthy(page);
    assert.ok((await page.locator('address').innerText()).includes(testLocation.street));assert.equal((await f.data.query('SELECT count(*) FROM fulfillment_arrangements WHERE order_id=$1',[result.orderReference])).rows[0].count,'0');await screenshot(page,'payment-collection-desktop');
  }finally{await context.close();}
});
