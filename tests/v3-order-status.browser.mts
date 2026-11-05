// Exercise retained direct-sales behavior; quotation-only denial has its own suites.
process.env.COMMERCE_MODE = "DIRECT_SALES";
import assert from 'node:assert/strict';
import { beforeEach,test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { adminBrowserHarness } from './helpers/admin-browser.mts';
import { orderStatusData } from './helpers/order-status-data.mts';
import { paymentEnvironment } from './helpers/paymob-mock.mts';
import { developmentId as id } from '../db/tools/seed.ts';
import { tokenHash } from '../src/lib/cart/session.ts';
import type { OrderView } from '../src/lib/payments/types.ts';

// The payment read pool is needed for an order view. Initiation stays disabled;
// every order below is a disposable snapshot, with no provider/payment rows.
paymentEnvironment.PAYMENTS_TEST_ENABLED='false';
paymentEnvironment.PAYMENTS_RECONCILIATION_READY='false';
const h=adminBrowserHarness(false,true,true),{origin}=h;
let browser:ReturnType<typeof h.current>['browser'],fixture:ReturnType<typeof h.current>['fixture'];
beforeEach(()=>{({browser,fixture}=h.current());});
type Page=Awaited<ReturnType<typeof browser.newPage>>;
type Context=Awaited<ReturnType<typeof browser.newContext>>;
async function start(width=1440) {
  const context:Context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width,height:1000},reducedMotion:'reduce'});
  context.setDefaultTimeout(10000);context.setDefaultNavigationTimeout(30000);
  const added=await context.request.post(origin+'/api/cart/items',{headers:{Origin:origin},data:{variantId:id(202),quantity:2}});assert.equal(added.status(),200);
  const cookie=(await context.cookies()).find((c:{name:string})=>c.name==='__Host-la-palme-bag');assert.ok(cookie);h.trackSecret(cookie.value);
  assert.equal(cookie.secure,true);assert.equal(cookie.httpOnly,true);assert.equal(cookie.sameSite,'Lax');
  const cart=(await fixture.data.query('SELECT id FROM carts WHERE session_token_hash=$1',[tokenHash(cookie.value)])).rows[0];
  const order=await orderStatusData(fixture.data,cookie.value,cart.id),page:Page=await context.newPage();await page.bringToFront();
  const errors:string[]=[];page.on('pageerror',(error:Error)=>errors.push(error.message));
  return {context,page,errors,...order};
}
async function open(page:Page,reference:string){await page.goto(origin+'/orders/'+reference);await page.getByRole('heading',{name:'Awaiting payment confirmation',exact:true}).waitFor();await page.locator('[data-order-reference]').waitFor();}
async function refresh(page:Page){await page.getByRole('button',{name:'Refresh order status',exact:true}).click();}
async function noProtectedSummary(page:Page){assert.equal(await page.locator('[data-order-reference]').count(),0);assert.ok(!(await page.locator('main').innerText()).includes('Local status fixture jewellery'));}

for(const width of [320,768,1024,1440])test(`a temporary 503 retains only freshly reauthorized stale details and recovers at ${width}px`,async()=>{
  const a=await start(width);let failed=false,paymentRequests=0;
  try{
    a.page.on('request',(request:{url():string;method():string})=>{if(request.method()==='POST'&&request.url().endsWith('/payment'))paymentRequests++;});
    await a.page.route(origin+'/api/orders/'+a.reference,async(route:{fetch():Promise<{json():Promise<{order:OrderView;paymentsAvailable:boolean}>}>;fulfill(value:unknown):Promise<void>})=>{
      if(failed){await route.fulfill({status:503,json:{message:'Temporary fixture failure.'}});return;}
      const body=await(await route.fetch()).json();
      // UI-only capability fixture proves uncertain status suppresses actions.
      // The server's initiation flags remain false and no payment is clicked.
      body.order.canContinue=true;body.order.attempt={reference:randomUUID(),status:'PENDING',initiationState:'READY'};body.paymentsAvailable=true;
      await route.fulfill({status:200,json:body});
    });
    await open(a.page,a.reference);await a.page.getByRole('button',{name:'Continue to Secure Payment',exact:true}).waitFor();
    const reference=await a.page.locator('[data-order-reference]').innerText();failed=true;await refresh(a.page);
    await a.page.getByRole('heading',{name:'Order status needs refreshing',exact:true}).waitFor();
    assert.match(await a.page.locator('main').getByRole('alert').innerText(),/previously verified.*outdated/);
    assert.equal(await a.page.locator('[data-order-reference]').innerText(),reference);assert.match(await a.page.locator('main').innerText(),/Last verified payment status: PENDING/);
    assert.equal(await a.page.getByRole('button',{name:'Continue to Secure Payment',exact:true}).count(),0);
    assert.equal(await a.page.getByRole('heading',{name:'Test payment received',exact:true}).count(),0);assert.equal(await a.page.getByRole('heading',{name:'Test payment unsuccessful',exact:true}).count(),0);
    assert.equal(await a.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    failed=false;await refresh(a.page);await a.page.getByRole('heading',{name:'Awaiting payment confirmation',exact:true}).waitFor();assert.equal(await a.page.locator('main').getByRole('alert').count(),0);
    assert.equal(await a.page.evaluate(()=>document.cookie.includes('la-palme-bag')),false);assert.deepEqual(await a.page.evaluate(()=>[Object.keys(localStorage),Object.keys(sessionStorage)]),[[],[]]);
    assert.equal((await fixture.data.query('SELECT count(*)::INTEGER AS count FROM payments WHERE order_id=$1',[a.reference])).rows[0].count,0);
    assert.equal(paymentRequests,0);assert.deepEqual(a.errors,[]);await h.screenshot(a.page,'v3-order-status-'+width);
  }finally{await a.context.close();}
});
test('network failure uses a fresh ownership proof, while failed proof hides protected data without claiming not found',async()=>{
  const a=await start();
  try{
    await open(a.page,a.reference);await a.page.route(origin+'/api/orders/'+a.reference,(route:{abort():Promise<void>})=>route.abort());await refresh(a.page);
    await a.page.getByRole('heading',{name:'Order status needs refreshing',exact:true}).waitFor();
    await a.page.route(origin+'/api/orders/'+a.reference+'/access',(route:{fulfill(value:unknown):Promise<void>})=>route.fulfill({status:503,json:{message:'Proof unavailable.'}}));await refresh(a.page);
    await a.page.getByRole('heading',{name:'Order status temporarily unavailable',exact:true}).waitFor();await noProtectedSummary(a.page);assert.equal(await a.page.getByRole('heading',{name:'Order unavailable',exact:true}).count(),0);
  }finally{await a.context.close();}
});
for(const status of [401,403,404])test(`authoritative ${status} clears the old summary immediately`,async()=>{
  const a=await start();
  try{
    await open(a.page,a.reference);await a.page.route(origin+'/api/orders/'+a.reference,(route:{fulfill(value:unknown):Promise<void>})=>route.fulfill({status,body:'Unavailable'}));await refresh(a.page);
    await a.page.getByRole('heading',{name:'Order unavailable',exact:true}).waitFor();await noProtectedSummary(a.page);
  }finally{await a.context.close();}
});
test('same-browser guest replacement or owner revocation prevents retaining a 503 summary',async()=>{
  for(const revoked of ['cookie','cart'] as const){
    const a=await start();
    try{
      await open(a.page,a.reference);await a.page.route(origin+'/api/orders/'+a.reference,(route:{fulfill(value:unknown):Promise<void>})=>route.fulfill({status:503,json:{message:'Temporary fixture failure.'}}));
      if(revoked==='cookie')await a.context.clearCookies();else await fixture.data.query("UPDATE carts SET status='EXPIRED' WHERE id=$1",[a.cartId]);
      await refresh(a.page);await a.page.getByRole('heading',{name:'Order unavailable',exact:true}).waitFor();await noProtectedSummary(a.page);
    }finally{await a.context.close();}
  }
});
test('an expired display lease or a proof for another reference cannot keep protected details visible',async()=>{
  const a=await start();let other=false;
  try{
    await open(a.page,a.reference);await a.page.route(origin+'/api/orders/'+a.reference,(route:{fulfill(value:unknown):Promise<void>})=>route.fulfill({status:503,json:{message:'Temporary fixture failure.'}}));
    await a.page.route(origin+'/api/orders/'+a.reference+'/access',(route:{fulfill(value:unknown):Promise<void>})=>route.fulfill({status:200,json:{reference:other?randomUUID():a.reference,verified:true,validForMs:500}}));
    await refresh(a.page);await a.page.getByRole('heading',{name:'Order status needs refreshing',exact:true}).waitFor();await a.page.getByRole('heading',{name:'Order status temporarily unavailable',exact:true}).waitFor();await noProtectedSummary(a.page);
    await a.page.unroute(origin+'/api/orders/'+a.reference);await refresh(a.page);await a.page.getByRole('heading',{name:'Awaiting payment confirmation',exact:true}).waitFor();
    other=true;await a.page.route(origin+'/api/orders/'+a.reference,(route:{fulfill(value:unknown):Promise<void>})=>route.fulfill({status:503,json:{message:'Temporary fixture failure.'}}));await refresh(a.page);
    await a.page.getByRole('heading',{name:'Order status temporarily unavailable',exact:true}).waitFor();await noProtectedSummary(a.page);
  }finally{await a.context.close();}
});
test('a first-read service failure is temporary and a foreign guest sees no private order data',async()=>{
  const a=await start(),outsider:Context=await browser.newContext({ignoreHTTPSErrors:true});
  try{
    await a.page.route(origin+'/api/orders/'+a.reference,(route:{fulfill(value:unknown):Promise<void>})=>route.fulfill({status:503,json:{message:'Temporary fixture failure.'}}));
    await a.page.goto(origin+'/orders/'+a.reference);await a.page.getByRole('heading',{name:'Order status temporarily unavailable',exact:true}).waitFor();await noProtectedSummary(a.page);
    const page:Page=await outsider.newPage();await page.bringToFront();await page.goto(origin+'/orders/'+a.reference);await page.getByRole('heading',{name:'Order unavailable',exact:true}).waitFor();await noProtectedSummary(page);
    const denied=await outsider.request.get(origin+'/api/orders/'+a.reference+'/access');assert.equal(denied.status(),404);assert.equal(denied.headers()['cache-control'],'private, no-store, max-age=0');
  }finally{await outsider.close();await a.context.close();}
});
test('leaving the visible page clears retained private data before it can enter page history',async()=>{
  const a=await start();
  try{
    await open(a.page,a.reference);await a.page.route(origin+'/api/orders/'+a.reference,(route:{fulfill(value:unknown):Promise<void>})=>route.fulfill({status:503,json:{message:'Temporary fixture failure.'}}));await refresh(a.page);
    await a.page.getByRole('heading',{name:'Order status needs refreshing',exact:true}).waitFor();
    await a.page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide')));
    await a.page.getByRole('heading',{name:'Opening order status',exact:true}).waitFor();await noProtectedSummary(a.page);
  }finally{await a.context.close();}
});
