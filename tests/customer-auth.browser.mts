import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { adminBrowserHarness } from "./helpers/admin-browser.mts";
import { developmentId } from "../db/tools/seed.ts";

// Browser plugin not available. Existing local HTTPS Playwright/Next harness.
// Flow: public jewel -> request -> code sign-in -> selected form -> owned history.
const h=adminBrowserHarness(true,false,false,false,{requests:true});
const {origin}=h;
test("new customer resumes the exact ring and variant, submits a quotation and views private history",{timeout:90000},async()=>{
 const {browser,fixture}=h.current(),context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:1000}}),page=await context.newPage();
 try{
  await page.goto(origin+'/jewels/dev-unique-ring');
  await page.getByRole('link',{name:'Request a Quotation',exact:true}).click();
  await page.getByRole('link',{name:'Sign In / Create Account',exact:true}).click();
  await page.waitForURL((url: URL) => url.pathname === '/account/sign-in');
  assert.equal(new URL(page.url()).pathname,'/account/sign-in');const destination=new URL(page.url()).searchParams.get('returnTo')!;
  assert.equal(new URL(destination,origin).searchParams.get('variant'),developmentId(201));
  await page.getByRole('button',{name:'Create an account',exact:true}).click();
  const email=`browser-${randomUUID()}@boutique.test`;
  await page.getByLabel('Your name',{exact:true}).fill('Local Browser Customer');await page.getByLabel('Email address',{exact:true}).fill(email);
  await page.getByRole('button',{name:'Send sign-in code',exact:true}).click();await page.getByLabel('Verification code',{exact:true}).waitFor();
  const mail=h.customerEmails.filter(m=>m.email===email).at(-1);assert.ok(mail);
  await page.getByLabel('Verification code',{exact:true}).fill(mail.otp).catch(()=>{throw Error('Local code entry failed; private value withheld.');});
  await page.getByRole('button',{name:'Verify and continue',exact:true}).click();await page.waitForURL(origin+destination);
  await page.getByLabel('Your name (required)',{exact:true}).waitFor();assert.equal(await page.getByLabel('Your name (required)',{exact:true}).inputValue(),'Local Browser Customer');
  assert.equal(await page.locator('input[name="email"]').inputValue(),email);assert.equal(await page.locator('input[name="email"]').getAttribute('readonly'),'');
  assert.equal(await page.getByLabel('Selected configuration',{exact:true}).inputValue(),developmentId(201));
  const message='LOCAL PRIVATE CUSTOMER BROWSER REQUEST '+randomUUID();await page.locator('textarea[name="message"]').fill(message);
  await page.getByRole('button',{name:'Send request',exact:true}).click();await page.getByRole('heading',{name:'Your request has been received.',exact:true}).waitFor();
  assert.equal((await fixture.data.query('SELECT count(*) FROM product_enquiries WHERE message=$1',[message])).rows[0].count,'1');
  await page.goto(origin+'/account');await page.getByText(message,{exact:true}).waitFor();
  const html=await (await context.request.get(origin+'/account')).text();assert.ok(!html.includes(message));assert.ok(!html.includes(email));
  const headers=(await context.request.get(origin+'/api/account/requests')).headers();assert.match(headers['cache-control'],/private.*no-store/);
  await page.getByRole('button',{name:'Personal Details',exact:true}).click();assert.equal(await page.getByLabel('Verified email',{exact:true}).inputValue(),email);
  await page.getByLabel('Name',{exact:true}).fill('Updated Browser Customer');await page.getByRole('button',{name:'Save personal details',exact:true}).click();
  await page.getByRole('button',{name:'Personal Details',exact:true}).click();assert.equal(await page.getByLabel('Name',{exact:true}).inputValue(),'Updated Browser Customer');
 }finally{await context.close();}
});
test("responsive public navigation, protected forms and customer account fit every required viewport",{timeout:150000},async()=>{
 const {browser,fixture}=h.current();
 for(const width of [320,375,768,1024,1440,1536,1920]){
  const context=await browser.newContext({ignoreHTTPSErrors:true,reducedMotion:'reduce',viewport:{width,height:1000}});await h.customerContext(context);const page=await context.newPage();const errors:string[]=[];page.on('pageerror',()=>errors.push('runtime error'));
  try{
   for(const path of ['/','/collections','/appointment?intent=CONSULTATION&channel=BOUTIQUE','/account']){
    const response=await page.goto(origin+path,{waitUntil:'networkidle'});assert.equal(response!.status(),200);assert.ok((await page.locator('main').innerText()).trim().length>0);assert.equal(await page.locator('nextjs-portal').count(),0);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),path+' at '+width);
    assert.ok(await page.getByRole('navigation',{name:'Primary navigation',exact:true}).evaluate((nav:HTMLElement)=>{
     const visible=[...nav.children].map(element=>element.getBoundingClientRect()).filter(rect=>rect.width>0&&rect.height>0);
     const text=nav.querySelector('.navbar-brand-text') as HTMLElement|null,wordmark=text?.getBoundingClientRect();
     return visible.every((rect,index)=>index===0||visible[index-1].right+8<=rect.left)&&(!wordmark?.width||wordmark.right+8<=visible[1].left);
    }),`Header elements must not overlap at ${width}px on ${path}`);
    if(path.startsWith('/appointment')){assert.equal(await page.getByLabel('Consultation preference',{exact:true}).inputValue(),'BOUTIQUE');assert.equal(await page.locator('input[name="email"]').inputValue(),fixture.customerEmail);}
   }
   if(width<1024){await page.getByRole('button',{name:'Open menu',exact:true}).click();await page.getByRole('button',{name:'Close menu',exact:true}).waitFor();await page.keyboard.press('Escape');assert.equal(await page.getByRole('button',{name:'Open menu',exact:true}).getAttribute('aria-expanded'),'false');}
   const brand=await page.locator('.navbar-brand-text').evaluate((e: HTMLElement)=>({shown:getComputedStyle(e).display!=='none',clipped:e.scrollWidth>e.clientWidth}));assert.ok(!brand.shown||!brand.clipped);
   await h.screenshot(page,'customer-account-'+width);assert.deepEqual(errors,[]);
  }finally{await context.close();}
 }
});

test("real background restoration denies both revoked and expired customer sessions",{timeout:90000},async()=>{
 const {browser,fixture}=h.current();
 for(const operation of ['revoke','expire']){
  const context=await browser.newContext({ignoreHTTPSErrors:true});const identity=await fixture.customerSignIn!();
  const pair=identity.headers.get('Cookie')!.split(';')[0],at=pair.indexOf('=');await context.addCookies([{name:pair.slice(0,at),value:pair.slice(at+1),url:origin,httpOnly:true,secure:true,sameSite:'Lax'}]);
  try{
   const page=await context.newPage(),message='LOCAL BACKGROUND CUSTOMER '+randomUUID();
   assert.equal((await context.request.post(origin+'/api/requests',{headers:{Origin:origin},data:{submissionId:randomUUID(),kind:'BESPOKE',name:'Local Background Customer',message}})).status(),200);
   await page.goto(origin+'/account');await page.getByText(message,{exact:true}).waitFor();
   type Delegate={_mainFrameSession?:{_client?:{send(method:string,params:{enabled:boolean}):Promise<unknown>}}};
   const nativeFocus=async(target:typeof page)=>{const implementation=(target as unknown as {_connection:{toImpl(p:unknown):{delegate?:Delegate;_delegate?:Delegate}}})._connection.toImpl(target);const controller=(implementation._delegate??implementation.delegate)?._mainFrameSession?._client;assert.ok(controller,'Native tab visibility requires the in-process Chromium controller.');await controller.send('Emulation.setFocusEmulationEnabled',{enabled:false});};
   await nativeFocus(page);const other=await context.newPage();await nativeFocus(other);await other.goto(origin+'/collections');await other.bringToFront();
   await page.waitForFunction(()=>document.visibilityState==='hidden');assert.ok(!(await page.locator('main').innerText()).includes(message));
   await fixture.data.query(operation==='revoke'?'DELETE FROM customer_auth_sessions WHERE user_id=(SELECT id FROM customer_auth_users WHERE email=$1)':"UPDATE customer_auth_sessions SET expires_at=now()-interval '1 second' WHERE user_id=(SELECT id FROM customer_auth_users WHERE email=$1)",[identity.email]);
   await page.bringToFront();await page.getByRole('link',{name:'Sign In / Create Account',exact:true}).waitFor();assert.ok(!(await page.locator('main').innerText()).includes(message));
  }finally{await context.close();}
 }
});

test("a delayed private history response cannot repopulate the account after logout",{timeout:60000},async()=>{
 const {browser,fixture}=h.current(),context=await browser.newContext({ignoreHTTPSErrors:true}),identity=await fixture.customerSignIn!(),pair=identity.headers.get('Cookie')!.split(';')[0],at=pair.indexOf('=');await context.addCookies([{name:pair.slice(0,at),value:pair.slice(at+1),url:origin,httpOnly:true,secure:true,sameSite:'Lax'}]);const page=await context.newPage();
 let release!:()=>void;const blocked=new Promise<void>(resolve=>{release=resolve;});let ready!:()=>void;const held=new Promise<void>(resolve=>{ready=resolve;});
 const message='LOCAL DELAYED CUSTOMER '+randomUUID();
 try{
  assert.equal((await context.request.post(origin+'/api/requests',{headers:{Origin:origin},data:{submissionId:randomUUID(),kind:'BESPOKE',name:'Local Delayed Customer',message}})).status(),200);
  await page.route('**/api/account/requests?*',async(route:{fetch():Promise<{status():number}>;fulfill(value:unknown):Promise<void>})=>{const response=await route.fetch();assert.equal(response.status(),200);ready();await blocked;await route.fulfill({response}).catch(()=>{});});
  await page.goto(origin+'/account');await held;
  assert.equal((await context.request.post(origin+'/api/customer-auth/sign-out',{headers:{Origin:origin},data:{}})).status(),200);
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.getByRole('link',{name:'Sign In / Create Account',exact:true}).waitFor();
  await page.evaluate((secret:string)=>{(window as unknown as {privateLeak:boolean}).privateLeak=false;new MutationObserver(()=>{if(document.body.textContent?.includes(secret))(window as unknown as {privateLeak:boolean}).privateLeak=true;}).observe(document.body,{subtree:true,childList:true,characterData:true});},message);
  release();await page.waitForLoadState('networkidle');assert.equal(await page.evaluate(()=>(window as unknown as {privateLeak:boolean}).privateLeak),false);assert.ok(!(await page.locator('main').innerText()).includes(message));
 }finally{release();await context.close();}
});

test("quiet session polling remounts personal details when the authenticated identity changes",{timeout:60000},async()=>{
 const {browser,fixture}=h.current(),context=await browser.newContext({ignoreHTTPSErrors:true}),identity=await fixture.customerSignIn!(),initialPair=identity.headers.get('Cookie')!.split(';')[0],initialAt=initialPair.indexOf('=');await context.addCookies([{name:initialPair.slice(0,initialAt),value:initialPair.slice(initialAt+1),url:origin,httpOnly:true,secure:true,sameSite:'Lax'}]);const page=await context.newPage();
 try{
  await page.clock.install();await page.goto(origin+'/account');await page.getByRole('button',{name:'Personal Details',exact:true}).click();assert.equal(await page.getByLabel('Verified email',{exact:true}).inputValue(),identity.email);
  await page.getByLabel('Name',{exact:true}).fill('Unsaved Account A');
  const other=await fixture.customerSignIn!(),pair=other.headers.get('Cookie')!.split(';')[0],at=pair.indexOf('=');await context.addCookies([{name:pair.slice(0,at),value:pair.slice(at+1),url:origin,httpOnly:true,secure:true,sameSite:'Lax'}]);
  const rechecked=page.waitForResponse((response:{url():string;status():number})=>response.url()===origin+'/api/customer-auth/session'&&response.status()===200);await page.clock.runFor(30001);await rechecked;
  await page.getByRole('heading',{name:'My Requests',exact:true}).waitFor();await page.getByRole('button',{name:'Personal Details',exact:true}).click();assert.equal(await page.getByLabel('Verified email',{exact:true}).inputValue(),other.email);assert.notEqual(await page.getByLabel('Name',{exact:true}).inputValue(),'Unsaved Account A');
 }finally{await context.close();}
});

test("visible customer data clears when its absolute session expiry is reached",{timeout:30000},async()=>{
 const {browser,fixture}=h.current(),context=await browser.newContext({ignoreHTTPSErrors:true});const identity=await fixture.customerSignIn!(),pair=identity.headers.get('Cookie')!.split(';')[0],at=pair.indexOf('=');
 await context.addCookies([{name:pair.slice(0,at),value:pair.slice(at+1),url:origin,httpOnly:true,secure:true,sameSite:'Lax'}]);
 try{
  const page=await context.newPage();await fixture.data.query("UPDATE customer_auth_sessions SET expires_at=now()+interval '5 seconds' WHERE user_id=(SELECT id FROM customer_auth_users WHERE email=$1)",[identity.email]);
  await page.goto(origin+'/account');await page.getByRole('heading',{name:'My Account',exact:true}).waitFor();await page.getByRole('link',{name:'Sign In / Create Account',exact:true}).waitFor({timeout:10000});assert.equal(await page.getByRole('heading',{name:'My Account',exact:true}).count(),0);
 }finally{await context.close();}
});

test("request authorization denial clears private drafts while retaining a safe recovery reference",{timeout:60000},async()=>{
 const {browser,fixture}=h.current(),context=await browser.newContext({ignoreHTTPSErrors:true}),identity=await fixture.customerSignIn!(),pair=identity.headers.get('Cookie')!.split(';')[0],at=pair.indexOf('=');await context.addCookies([{name:pair.slice(0,at),value:pair.slice(at+1),url:origin,httpOnly:true,secure:true,sameSite:'Lax'}]);
 try{
  const page=await context.newPage(),message='LOCAL AUTHORIZATION DENIAL '+randomUUID();let reference='',attempts=0;
  await page.route('**/api/requests',async(route:{request():{postDataJSON():{submissionId:string}};fulfill(value:unknown):Promise<void>})=>{attempts++;reference=route.request().postDataJSON().submissionId;await route.fulfill({status:403,json:{message:'Local authorization denied.',outcome:'UNKNOWN'}});});
  await page.goto(origin+'/contact?intent=BESPOKE');await page.locator('textarea[name="message"]').fill(message);await page.getByRole('button',{name:'Send request',exact:true}).click();
  await page.getByRole('link',{name:'Sign In / Create Account',exact:true}).waitFor();assert.ok(!(await page.locator('main').innerText()).includes(message));assert.equal(await page.locator('textarea[name="message"]').count(),0);
  await page.getByRole('link',{name:'Sign In / Create Account',exact:true}).click();await page.getByRole('link',{name:'Continue to your request',exact:true}).click();await page.getByRole('heading',{name:'Check your saved request.',exact:true}).waitFor();
  assert.ok((await page.locator('main').innerText()).includes(reference));assert.ok(!(await page.locator('main').innerText()).includes(message));assert.equal(attempts,1);assert.equal(await page.getByRole('button',{name:'Retry this same request',exact:true}).count(),0);
 }finally{await context.close();}
});
test("logout, account switching and Back/Forward restoration cannot redisplay private customer records",{timeout:90000},async()=>{
 const {browser,fixture}=h.current(),context=await browser.newContext({ignoreHTTPSErrors:true});await h.customerContext(context);const page=await context.newPage();
 try{
  const message='LOCAL PRIVATE HISTORY '+randomUUID(),input={submissionId:randomUUID(),kind:'BESPOKE',name:'Local Privacy Customer',message};
  assert.equal((await context.request.post(origin+'/api/requests',{headers:{Origin:origin},data:input})).status(),200);
  await page.goto(origin+'/account');await page.getByText(message,{exact:true}).waitFor();
  await page.evaluate(()=>window.dispatchEvent(new Event('pagehide')));assert.ok(!(await page.locator('main').innerText()).includes(message));
  const customer=(await fixture.data.query("SELECT id FROM customer_auth_users WHERE email=$1",[fixture.customerEmail])).rows[0];await fixture.data.query('DELETE FROM customer_auth_sessions WHERE user_id=$1',[customer.id]);
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));await page.getByRole('link',{name:'Sign In / Create Account',exact:true}).waitFor();assert.ok(!(await page.locator('main').innerText()).includes(message));
  await page.goto(origin+'/collections');await page.goBack();await page.getByRole('link',{name:'Sign In / Create Account',exact:true}).waitFor();assert.ok(!(await page.locator('main').innerText()).includes(message));
  const other=await fixture.customerSignIn!();const cookie=other.headers.get('Cookie')!.split(';')[0],at=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,at),value:cookie.slice(at+1),url:origin,httpOnly:true,secure:true,sameSite:'Lax'}]);
  await page.reload();await page.getByRole('heading',{name:'My Account',exact:true}).waitFor();assert.ok(!(await page.locator('main').innerText()).includes(message));
  await page.goto(origin+'/collections');await page.goto(origin+'/account');await page.getByRole('heading',{name:'My Account',exact:true}).waitFor();
  await page.getByRole('button',{name:'Sign Out',exact:true}).click();await page.waitForURL(origin+'/account/sign-in');await page.goBack();await page.goBack();await page.getByRole('link',{name:'Sign In / Create Account',exact:true}).waitFor();assert.ok(!(await page.locator('main').innerText()).includes(message));
 }finally{await context.close();}
});
