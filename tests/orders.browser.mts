// Exercise retained direct-sales behavior; quotation-only denial has its own suites.
process.env.COMMERCE_MODE = "DIRECT_SALES";
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { adminBrowserHarness } from './helpers/admin-browser.mts';
import { fixtureOrder,type orderFixture } from './helpers/order-fixture.mts';
const h=adminBrowserHarness(false,true,true,true);
const fixture=()=>{const f=h.current().fixture as Awaited<ReturnType<typeof orderFixture>>;for(const value of [f.password,f.authConfig.secret,f.authConfig.databaseUrl,'Checkout Fixture','checkout-fixture@boutique.test','+201000000001'])h.trackSecret(value);return f;};
const local=(offset=0)=>{const d=new Date(Date.now()+offset);return [d.getFullYear(),'-',String(d.getMonth()+1).padStart(2,'0'),'-',String(d.getDate()).padStart(2,'0'),'T',String(d.getHours()).padStart(2,'0'),':',String(d.getMinutes()).padStart(2,'0')].join('');};
async function context(){const c=await h.current().browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000},reducedMotion:'reduce'});return c;}
// Browser objects come from the externally supplied Playwright module.
type Page=Awaited<ReturnType<ReturnType<typeof h.current>['browser']['newPage']>>;
async function choose(page:Page,value:string){assert.equal(await page.getByRole('combobox').count()>0,true,'Order action controls must render; heading: '+await page.locator('h1').innerText());await page.getByLabel('Operation',{exact:true}).selectOption(value);}
async function perform(page:Page,value:string,button:string){await choose(page,value);const response=page.waitForResponse((r: {url():string;request():{method():string}})=>r.url().includes('/api/admin/orders/')&&r.request().method()==='POST');await page.getByRole('button',{name:button,exact:true}).click();const result=await response;assert.equal(result.status(),200,'Operation '+value+': '+String((await result.json()).message));await page.getByRole('status').filter({hasText:'Operation recorded.'}).waitFor();}
async function schedule(page:Page){await choose(page,'propose');await page.getByLabel('Appointment start (device local)',{exact:true}).fill(local(86400000));await page.getByLabel('Appointment end (device local)',{exact:true}).fill(local(90000000));await perform(page,'propose','Propose appointment');await choose(page,'confirm');await page.getByLabel('Responsible administrator').selectOption(fixture().users.ADMIN.id);await perform(page,'confirm','Confirm agreed appointment');}
async function prepare(page:Page){await perform(page,'prepare','Prepare jewellery');await perform(page,'contact','Record customer contact');await schedule(page);}

test('desktop list filters, immutable details, payment history and private delivery handover work',{timeout:90000},async()=>{
  const f=fixture(),a=await fixtureOrder(f),c=await context(),page=await c.newPage(),errors:string[]=[];page.on('pageerror',(e:Error)=>errors.push(e.message));page.on('dialog',(d:{accept():Promise<void>})=>d.accept());
  try{await h.signIn(page);await page.getByRole('link',{name:'Manage orders',exact:true}).click();await page.waitForURL(h.origin+'/admin/orders');await page.getByRole('heading',{name:'Orders',exact:true}).waitFor();assert.equal(await page.title(),"Orders | La Palme d'Or Gems");await page.getByLabel('Order reference',{exact:true}).fill((await f.data.query('SELECT order_number FROM orders WHERE id=$1',[a.id])).rows[0].order_number);await page.getByRole('button',{name:'Filter orders'}).click();await page.getByRole('status').filter({hasText:'1 orders on this page.'}).waitFor();await page.getByRole('link',{name:/TEST-/}).click();await page.getByRole('heading',{name:'Payment status and history'}).waitFor();assert.match(await page.getByRole('region',{name:'Order overview'}).innerText(),/paid/i);assert.match(await page.getByRole('region',{name:'Purchased jewellery'}).innerText(),/DEV-102/);
    await prepare(page);await perform(page,'dispatch','Out for personal delivery');await choose(page,'complete');await page.getByLabel('Confirmed recipient name').fill('Browser fixture recipient');await page.getByLabel('Actual attempt time (device local)').fill(local());
    // Minute precision can precede a newly created order; use a valid actual instant.
    await page.getByLabel('Actual attempt time (device local)').fill(local(60000));await perform(page,'complete','Confirm jewellery handover');assert.match(await page.getByRole('region',{name:'Order overview'}).innerText(),/completed/i);assert.match(await page.getByRole('region',{name:'Internal notes and event history'}).innerText(),/Browser fixture recipient/);assert.ok(!await page.getByLabel('Operation',{exact:true}).locator('option[value="complete"]').count());
    await h.screenshot(page,'orders-desktop');assert.deepEqual(errors,[]);
  }finally{await c.close();}
});

test('collection scheduling, missed attempts, rescheduling and completed handover work on mobile',{timeout:90000},async()=>{
  const a=await fixtureOrder(fixture(),'BOUTIQUE_COLLECTION'),c=await context(),page=await c.newPage();page.on('dialog',(d:{accept():Promise<void>})=>d.accept());
  try{await page.setViewportSize({width:390,height:844});await h.signIn(page);await page.goto(h.origin+'/admin/orders/'+a.id);await prepare(page);await perform(page,'ready','Ready for collection');
    await choose(page,'failed');await page.getByLabel('Actual attempt time (device local)').fill(local(60000));await page.getByLabel('Operational reason').selectOption('COLLECTION_MISSED');await page.getByLabel('Follow-up').selectOption('RESCHEDULE');await perform(page,'failed','Record unsuccessful attempt');
    assert.match(await page.getByRole('region',{name:'Internal notes and event history'}).innerText(),/collection missed/);await schedule(page);
    await choose(page,'reschedule');await page.getByLabel('Appointment start (device local)').fill(local(172800000));await page.getByLabel('Appointment end (device local)').fill(local(187200000));await page.getByLabel('Operational reason').selectOption('CUSTOMER_RESCHEDULE');await perform(page,'reschedule','Reschedule appointment');
    await choose(page,'confirm');await page.getByLabel('Responsible administrator').selectOption(fixture().users.ADMIN.id);await perform(page,'confirm','Confirm agreed appointment');await perform(page,'ready','Ready for collection');await choose(page,'complete');await page.getByLabel('Confirmed recipient name').fill('Collection fixture recipient');await page.getByLabel('Actual attempt time (device local)').fill(local(60000));await perform(page,'complete','Confirm jewellery handover');
    assert.match(await page.getByRole('region',{name:'Order overview'}).innerText(),/completed/);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await h.screenshot(page,'orders-mobile');
  }finally{await c.close();}
});

test('stale browser conflict, invalid server transition and explicit reload protect concurrent edits',async()=>{
  const a=await fixtureOrder(fixture()),c=await context(),page=await c.newPage();
  try{await h.signIn(page);await page.goto(h.origin+'/admin/orders/'+a.id);const old=await (await page.request.get(h.origin+'/api/admin/orders/'+a.id)).json();const update=await page.request.post(h.origin+'/api/admin/orders/'+a.id,{headers:{Origin:h.origin},data:{action:'prepare',revision:old.order.revision,operationId:randomUUID()}});assert.equal(update.status(),200);
    await choose(page,'prepare');await page.getByRole('button',{name:'Prepare jewellery',exact:true}).click();await page.getByRole('status').filter({hasText:'changed in another session'}).waitFor();assert.equal(await page.getByRole('button',{name:'Prepare jewellery',exact:true}).isDisabled(),true);await page.getByRole('button',{name:'Reload order'}).click();await page.getByRole('status').filter({hasText:'Current order loaded.'}).waitFor();assert.equal(await page.getByLabel('Operation',{exact:true}).inputValue(),'note');
    const current=await (await page.request.get(h.origin+'/api/admin/orders/'+a.id)).json();const invalid=await page.request.post(h.origin+'/api/admin/orders/'+a.id,{headers:{Origin:h.origin},data:{action:'dispatch',revision:current.order.revision,operationId:randomUUID()}});assert.equal(invalid.status(),409);
  }finally{await c.close();}
});

test('payment exception acknowledgment stays visible and does not unlock fulfillment',async()=>{
  const f=fixture(),a=await fixtureOrder(f);await f.data.query("UPDATE orders SET reconciliation_required=true,reconciliation_reason='LATE_SUCCESS' WHERE id=$1",[a.id]);const c=await context(),page=await c.newPage();
  try{await h.signIn(page);await page.goto(h.origin+'/admin/orders/'+a.id);assert.match(await page.getByRole('region',{name:'Payment exceptions'}).innerText(),/late success/);await choose(page,'acknowledge');await page.getByLabel('Internal operational note').fill('Browser fixture exception review');await perform(page,'acknowledge','Acknowledge payment exception');assert.match(await page.getByRole('region',{name:'Payment exceptions'}).innerText(),/Review required/);assert.equal(await page.getByLabel('Operation',{exact:true}).locator('option[value="prepare"]').count(),0);
  }finally{await c.close();}
});

test('catalogue-only staff cannot open order pages or protected APIs; keyboard focus remains visible',async()=>{
  const c=await context(),page=await c.newPage(),f=fixture();
  try{await page.goto(h.origin+'/admin/login');await page.getByLabel('Email address',{exact:true}).fill(f.users.CATALOGUE_MANAGER.email);await page.getByLabel('Password',{exact:true}).fill(f.password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL(h.origin+'/admin');assert.equal(await page.getByRole('link',{name:'Manage orders'}).count(),0);await page.goto(h.origin+'/admin/orders');await page.getByRole('heading',{name:'Orders unavailable'}).waitFor();assert.equal((await page.request.post(h.origin+'/api/admin/orders/search',{headers:{Origin:h.origin},data:{}})).status(),403);await page.keyboard.press('Tab');assert.equal(await page.locator(':focus').count(),1);
  }finally{await c.close();}
});

test('owning customer sees safe preparation status and other browsers see no order',async()=>{
  const f=fixture(),a=await fixtureOrder(f),admin=await context(),page=await admin.newPage();
  try{await h.signIn(page);await page.goto(h.origin+'/admin/orders/'+a.id);await perform(page,'prepare','Prepare jewellery');const guest=await context();try{h.trackSecret(a.token);await guest.addCookies([{name:'__Host-la-palme-bag',value:a.token,domain:'127.0.0.1',path:'/',secure:true,httpOnly:true,sameSite:'Lax'}]);const customer=await guest.newPage();await customer.goto(h.origin+'/orders/'+a.id);await customer.getByText('Your jewellery is being prepared.',{exact:true}).first().waitFor();const body=await customer.locator('body').innerText();assert.ok(!body.includes('Fixture OWNER'));assert.ok(!body.includes('Internal operational note'));const outsider=await context();try{const r=await outsider.request.get(h.origin+'/api/orders/'+a.id);assert.equal(r.status(),404);}finally{await outsider.close();}}finally{await guest.close();}
  }finally{await admin.close();}
});
