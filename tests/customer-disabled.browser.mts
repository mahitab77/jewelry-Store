import assert from 'node:assert/strict';
import {beforeEach,test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {adminBrowserHarness} from './helpers/admin-browser.mts';
import {developmentId} from '../db/tools/seed.ts';

// Browser plugin not available. Read/interaction checks use the existing local
// production Next/HTTPS harness. Customer flags are false; no mail mock is needed.
// Flow: public browsing -> gated request/account -> disabled response; admin login
// remains separate. Availability must never expose unusable registration controls.
const h=adminBrowserHarness(true),{origin}=h;
const unavailable='Private account access is being prepared. You are welcome to explore our collections in the meantime.';
const rings:Array<{id:string;slug:string;name:string;variant:string}>=[];
// Seed only after the shared harness has completed its asynchronous startup.
beforeEach(async()=>{
 if(rings.length)return;
 const {fixture}=h.current(),category=randomUUID();await fixture.data.query("INSERT INTO categories(id,slug,name,is_visible) VALUES($1,'rings','Rings',true)",[category]);
 for(let i=0;i<5;i++){
  const id=randomUUID(),variant=randomUUID(),slug='local-disabled-ring-'+id,name='LOCAL TEST ONLY Ring '+(i+1);rings.push({id,variant,slug,name});
  await fixture.data.query("INSERT INTO products(id,slug,name,description,product_type,sales_mode,status,published_at) VALUES($1,$2,$3,'LOCAL TEST ONLY disposable public ring fixture.','REPEATABLE','ENQUIRY_ONLY','PUBLISHED','2020-01-01T00:00:00Z')",[id,slug,name]);
  await fixture.data.query('INSERT INTO product_categories(product_id,category_id) VALUES($1,$2)',[id,category]);
  await fixture.data.query("INSERT INTO product_variants(id,product_id,product_type,sku,configuration_label,is_active) VALUES($1,$2,'REPEATABLE',$3,'LOCAL TEST ONLY original configuration',true)",[variant,id,'LOCAL-'+variant.toUpperCase()]);
  await fixture.data.query("INSERT INTO product_media(product_id,external_media_reference,media_type,alt_text,is_primary) VALUES($1,'/images/ring-emerald.png','IMAGE','LOCAL TEST ONLY ring photograph',true)",[id]);
 }
});
test('disabled customer runtime preserves public catalogue photographs and refuses anonymous private operations',async()=>{
 const {browser}=h.current(),context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000}}),page=await context.newPage();
 try{
  const errors:string[]=[];page.on('pageerror',()=>errors.push('runtime error'));
  for(const path of ['/','/collections','/collections/dev-rings','/jewels/dev-unique-ring']){const response=await page.goto(origin+path,{waitUntil:'networkidle'});assert.equal(response!.status(),200);assert.ok((await page.locator('main').innerText()).trim());assert.equal(await page.locator('nextjs-portal').count(),0);}
  assert.ok(await page.locator('main img').count()>0);assert.ok(await page.locator('main img').first().evaluate((image:HTMLImageElement)=>image.complete&&image.naturalWidth>0));
  const session=await context.request.get(origin+'/api/customer-auth/session');assert.equal(session.status(),200);assert.deepEqual(await session.json(),{customer:null,available:false});assert.match(session.headers()['cache-control'],/no-store/);
  for(const path of ['/api/account','/api/account/requests','/api/account/appointments'])assert.equal((await context.request.get(origin+path)).status(),503);
  for(const path of ['/api/customer-auth/send-code','/api/requests']){const response=await context.request.post(origin+path,{headers:{Origin:origin},data:{email:'disabled@boutique.test'}});assert.equal(response.status(),503);const body=await response.text();assert.ok(!/postgres(?:ql)?:\/\/|password|stack|NEON_STAGING_DIRECT_URL/.test(body));}
  for(const path of ['/contact?intent=BESPOKE','/appointment','/account']){await page.goto(origin+path,{waitUntil:'networkidle'});assert.equal(await page.getByRole('button',{name:'Send request',exact:true}).count(),0);assert.equal(await page.getByRole('heading',{name:'My Account',exact:true}).count(),0);}
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});
test('administrator login works independently while customer authentication and email stay disabled',async()=>{
 const {browser}=h.current(),context=await browser.newContext({ignoreHTTPSErrors:true}),page=await context.newPage();
 try{await h.signIn(page,'OWNER');assert.equal(new URL(page.url()).pathname,'/admin');assert.deepEqual(await(await context.request.get(origin+'/api/customer-auth/session')).json(),{customer:null,available:false});assert.equal((await context.request.get(origin+'/api/account')).status(),503);}finally{await context.close();}
});
test('disabled account pages announce unavailability without offering registration or code sending',async()=>{
 const {browser}=h.current(),context=await browser.newContext({ignoreHTTPSErrors:true}),page=await context.newPage();
 try{await page.goto(origin+'/account/sign-in',{waitUntil:'networkidle'});await page.getByText(unavailable,{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Send sign-in code',exact:true}).count(),0,'Disabled registration must not offer code sending.');assert.equal(await page.getByRole('button',{name:'Create an account',exact:true}).count(),0);assert.match(await page.locator('main').innerText(),/not (?:yet )?available|temporarily unavailable/i);await page.locator('main').getByRole('link',{name:'Explore the collections',exact:true}).click();await page.waitForURL(origin+'/collections');}finally{await context.close();}
});

test('disabled actions retain the chosen product and variant across every required width',{timeout:180000},async()=>{
 const {browser}=h.current();
 for(const width of [320,375,768,1024,1440]){
  const context=await browser.newContext({ignoreHTTPSErrors:true,reducedMotion:'reduce',viewport:{width,height:1000}}),page=await context.newPage();let sends=0;const errors:string[]=[];
  page.on('pageerror',()=>errors.push('runtime error'));page.on('request',(request:{url():string;method():string})=>{if(request.method()==='POST'&&/\/api\/(?:customer-auth|requests)/.test(request.url()))sends++;});
  try{
   for(const path of ['/account/sign-in','/account','/contact?intent=BESPOKE','/appointment?intent=CONSULTATION&channel=BOUTIQUE']){
    await page.goto(origin+path,{waitUntil:'networkidle'});await page.getByText(unavailable,{exact:true}).waitFor();assert.equal(await page.locator('main form').count(),0);assert.equal(await page.getByRole('button',{name:'Send request',exact:true}).count(),0);assert.equal(await page.getByRole('link',{name:'Sign In / Create Account',exact:true}).count(),0);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    if(path==='/account/sign-in'&&process.env.ADMIN_SCREENSHOT_DIR)await page.screenshot({path:join(process.env.ADMIN_SCREENSHOT_DIR,'customer-unavailable-'+width+'.png'),animations:'disabled'});
   }
   await page.getByRole('link',{name:'Account access',exact:true}).click();await page.waitForURL(origin+'/account');await page.getByText(unavailable,{exact:true}).waitFor();
   if(width<1024){await page.getByRole('button',{name:'Open menu',exact:true}).click();await page.getByRole('button',{name:'Close menu',exact:true}).waitFor();await page.keyboard.press('Escape');assert.equal(await page.getByRole('button',{name:'Open menu',exact:true}).getAttribute('aria-expanded'),'false');}
   await page.goto(origin+'/jewels/dev-repeatable-earrings');await page.getByRole('radio',{name:/Development alternate/}).check();
   for(const name of ['Request a Quotation','Request Changes','Consult the Designer']){
    const link=page.locator('main').getByRole('link',{name,exact:true}),href=await link.getAttribute('href');assert.ok(href!.includes(developmentId(207)));await link.click();await page.getByText(unavailable,{exact:true}).waitFor();assert.equal(new URL(page.url()).searchParams.get('variant'),developmentId(207));assert.match(await page.locator('main').innerText(),/Selected configuration:.*Development alternate/);assert.ok(await page.locator('main a[href="/jewels/dev-repeatable-earrings"]').count());assert.equal(await page.locator('main form').count(),0);await page.goBack();await page.getByRole('radio',{name:/Development alternate/}).check();
   }
   assert.equal(sends,0);assert.deepEqual(errors,[]);
  }finally{await context.close();}
 }
});

test('all five local Rings remain visible with photographs and unchanged request context while access is disabled',{timeout:90000},async()=>{
 const {browser,fixture}=h.current(),context=await browser.newContext({ignoreHTTPSErrors:true}),page=await context.newPage();
 const snapshot=JSON.stringify((await fixture.data.query('SELECT to_jsonb(p) row FROM products p WHERE id=ANY($1::uuid[]) ORDER BY id',[rings.map(r=>r.id)])).rows);
 try{
  await page.goto(origin+'/collections/rings',{waitUntil:'networkidle'});assert.equal(await page.locator('main article').count(),5);
  for(const ring of rings){await page.goto(origin+'/jewels/'+ring.slug,{waitUntil:'networkidle'});await page.getByRole('heading',{name:ring.name,exact:true}).waitFor();assert.ok(await page.locator('main img').first().evaluate((image:HTMLImageElement)=>image.complete&&image.naturalWidth>0));const link=page.getByRole('link',{name:'Request a Quotation',exact:true});assert.ok((await link.getAttribute('href'))!.includes(ring.variant));await link.click();await page.getByText(unavailable,{exact:true}).waitFor();assert.ok((await page.locator('main').innerText()).includes(ring.name));}
  assert.equal(JSON.stringify((await fixture.data.query('SELECT to_jsonb(p) row FROM products p WHERE id=ANY($1::uuid[]) ORDER BY id',[rings.map(r=>r.id)])).rows),snapshot);
 }finally{await context.close();}
});
