import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import { requestFixture } from "./helpers/request-fixture.mts";
import { customerAuthHttp } from "../src/lib/customer/http.ts";
import { customerAccountHttp } from "../src/lib/customer/account.ts";
import { requireCustomer } from "../src/lib/customer/authorization.ts";
import { getCurrentAdmin } from "../src/lib/admin/authorization.ts";
import { customerConfiguration } from "../src/lib/customer/config.ts";
import { customerMailer } from "../src/lib/customer/email.ts";
import { customerReturn } from "../src/lib/customer/intent.ts";
import { submitRequest } from "../src/lib/requests/repository.ts";
import { requestsHttp } from "../src/lib/requests/http.ts";
import { developmentId } from "../db/tools/seed.ts";
import { createCustomerRuntime } from "../src/lib/customer/runtime.ts";
let f: Awaited<ReturnType<typeof requestFixture>>;
before(async () => { f = await requestFixture(); }, { timeout: 60000 });
beforeEach(async () => { await f.data.query("DELETE FROM customer_auth_rate_limits"); await f.data.query("DELETE FROM cart_rate_limits"); });
after(async () => { if (f) await f.close(); });
const input = (extra = {}) => ({ submissionId: randomUUID(), kind: "QUOTATION", productId: developmentId(101), variantId: developmentId(201), name: "Local customer request", message: "A private local request fixture.", ...extra });
const account = (path = "", headers = f.customerHeaders, method = "GET", body?: unknown) => customerAccountHttp(new Request(f.customerConfig.baseURL + "/api/account" + path, { method, headers: { ...Object.fromEntries(headers), Origin: f.customerConfig.baseURL, "Content-Type":"application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }), path.split("?")[0].split("/").filter(Boolean), f.customerRuntime);

test("session availability is server-derived and separate from customer authorization", async()=>{
 const session=(headers=new Headers())=>new Request(f.customerConfig.baseURL+'/api/customer-auth/session',{headers});
 const anonymous=await customerAuthHttp(session(),f.customerRuntime);assert.deepEqual(await anonymous.json(),{customer:null,available:true});assert.match(anonymous.headers.get('cache-control')!,/no-store/);
 const verified=await(await customerAuthHttp(session(f.customerHeaders),f.customerRuntime)).json();assert.equal(verified.available,true);assert.equal(verified.customer.email,f.customerEmail);assert.ok(!('token' in verified.customer));
 const disabled=await customerAuthHttp(session());assert.deepEqual(await disabled.json(),{customer:null,available:false});
});
test("public activation and live delivery fail closed without independent secret and approved sender", async () => {
  assert.throws(() => customerConfiguration({ NODE_ENV: "test" })); assert.throws(() => customerMailer({ NODE_ENV: "test" }));
  const response = await customerAuthHttp(new Request("https://local.test/api/customer-auth/send-code", { method:"POST" })); assert.equal(response.status,503);
  let calls = 0;
  const mail = customerMailer({ NODE_ENV: "test", CUSTOMER_EMAIL_APPROVED:"true",CUSTOMER_EMAIL_API_KEY:"local-test-key",CUSTOMER_EMAIL_FROM:"auth@boutique.test" }, async () => { calls++; return new Response(null,{status:503}); });
  await assert.rejects(mail({email:"local@boutique.test",otp:"12345678"})); assert.equal(calls,1);
});
test("registration verifies eight-digit codes with HMAC storage, secure separate cookies and one profile", async () => {
  const email=`new-${randomUUID()}@boutique.test`;
  const sent=await f.customerAuth("send-code",{email}); assert.equal(sent.status,200); assert.ok(!(await sent.text()).includes(email));
  const code=f.emails.at(-1)!.otp; assert.ok(/^\d{8}$/.test(code),'Code must contain eight digits.');
  const verification=(await f.data.query("SELECT value,EXTRACT(EPOCH FROM expires_at-created_at)::float AS lifetime FROM customer_auth_verifications WHERE identifier=$1",['sign-in-otp-'+email])).rows[0]; assert.ok(!verification.value.includes(code)); assert.match(verification.value,/^[a-f0-9]{64}:0$/);assert.ok(verification.lifetime>=299&&verification.lifetime<=301);
  assert.equal((await f.data.query("SELECT count(*) FROM customer_auth_users WHERE email=$1",[email])).rows[0].count,"0");
  const verified=await f.customerAuth("verify-code",{email,code,name:"New Local Customer"}); assert.equal(verified.status,200); assert.deepEqual(await verified.json(),{ok:true});
  const cookie=verified.headers.getSetCookie().find(c=>c.includes('lapalme_customer.session_token'))!; assert.match(cookie,/HttpOnly/); assert.match(cookie,/Secure/); assert.match(cookie,/SameSite=Lax/i);
  assert.equal((await f.customerAuth("verify-code",{email,code,name:"New Local Customer"})).status,400);
  assert.equal((await f.data.query("SELECT count(*) FROM customer_profiles WHERE auth_provider='better-auth-customer' AND email=$1",[email])).rows[0].count,"1");
});
test("returning customer needs no name, cooldown is distributed, wrong code budget expires and cannot replay", async () => {
  const email=f.customerEmail;
  assert.equal((await f.customerAuth("send-code",{email})).status,200);
  assert.equal((await f.customerAuth("send-code",{email})).status,429);
  const code=f.emails.at(-1)!.otp;
  const response=await f.customerAuth("verify-code",{email,code});assert.equal(response.status,200);
  const other=`attempt-${randomUUID()}@boutique.test`;await f.customerAuth("send-code",{email:other});const correct=f.emails.at(-1)!.otp;
  for(let i=0;i<3;i++)assert.equal((await f.customerAuth("verify-code",{email:other,code:correct==='00000000'?'11111111':'00000000',name:'Local Customer'})).status,400);
  assert.equal((await f.customerAuth("verify-code",{email:other,code:correct,name:'Local Customer'})).status,400);
  const expired=`expired-${randomUUID()}@boutique.test`;await f.customerAuth("send-code",{email:expired});const old=f.emails.at(-1)!.otp;await f.data.query("UPDATE customer_auth_verifications SET expires_at=now()-INTERVAL '1 second' WHERE identifier=$1",['sign-in-otp-'+expired]);
  assert.equal((await f.customerAuth("verify-code",{email:expired,code:old,name:'Local Customer'})).status,400);
});
test("send failure never reports delivery; raw library and unexpected fields are unavailable", async () => {
  f.delivery.fails=true;try{assert.equal((await f.customerAuth('send-code',{email:`fail-${randomUUID()}@boutique.test`})).status,503);}finally{f.delivery.fails=false;}
  for(const op of ['sign-up/email','sign-in/email','get-session','email-otp/get-verification-otp','email-otp/create-verification-otp'])assert.equal((await f.customerAuth(op,{})).status,404);
  assert.equal((await f.customerAuth('send-code',{email:'local@boutique.test',role:'ADMIN'})).status,400);
  const cross=await customerAuthHttp(new Request(f.customerConfig.baseURL+'/api/customer-auth/send-code',{method:'POST',headers:{Origin:'https://attacker.test','Content-Type':'application/json'},body:'{}'}),f.customerRuntime);assert.equal(cross.status,403);
});
test("customer and administrator sessions are isolated even with the same email", async () => {
  const admin=await f.headers('OWNER');await assert.rejects(requireCustomer(admin,f.customerRuntime),{status:401});assert.equal(await getCurrentAdmin(f.customerHeaders,f.runtime),null);
  const registered=await f.customerSignIn(f.users.OWNER.email,'Local Separate Customer');assert.equal(await getCurrentAdmin(registered.headers,f.runtime),null);
  await assert.rejects(submitRequest(input(),f.customerRuntime),{status:401});
  const anonymous=await requestsHttp(new Request(f.customerConfig.baseURL+'/api/requests',{method:'POST',headers:{Origin:f.customerConfig.baseURL,'Content-Type':'application/json'},body:JSON.stringify(input())}),f.customerRuntime);assert.equal(anonymous.status,401);
});
test("all five request journeys save authenticated ownership and original snapshots, with no purchase writes", async () => {
  const c=await requireCustomer(f.customerHeaders,f.customerRuntime);
  for(const extra of [{},{kind:'MODIFICATION'},{kind:'BESPOKE',productId:undefined,variantId:undefined},{kind:'CONSULTATION',channel:'ZOOM'},{kind:'CONSULTATION',channel:'BOUTIQUE'}]){
    const value=input(extra);await submitRequest(value,f.customerRuntime,f.customerHeaders);
    const rows=(await f.data.query('SELECT customer_profile_id,contact_email FROM product_enquiries WHERE id=$1 UNION ALL SELECT customer_profile_id,contact_email FROM bespoke_requests WHERE id=$1 UNION ALL SELECT customer_profile_id,contact_email FROM appointment_requests WHERE id=$1',[value.submissionId])).rows;
    assert.equal(rows.length,1);assert.equal(rows[0].customer_profile_id,c.profileId);assert.equal(rows[0].contact_email,c.email);
  }
  assert.equal((await f.data.query('SELECT count(*) FROM orders')).rows[0].count,'0');
});
test("idempotency checks ownership first; customer histories never claim guests or expose staff", async () => {
  const value=input();await submitRequest(value,f.customerRuntime,f.customerHeaders);assert.equal((await submitRequest(value,f.customerRuntime,f.customerHeaders)).reference,value.submissionId);
  const other=await f.customerSignIn();await assert.rejects(submitRequest(value,f.customerRuntime,other.headers),{status:409});
  const denied=await account('/requests/'+value.submissionId,other.headers);assert.equal(denied.status,404);
  const guest=randomUUID();await f.data.query("INSERT INTO product_enquiries(id,contact_name,contact_email,message) VALUES($1,'Local Guest',$2,'Guest private fixture')",[guest,f.customerEmail]);
  const own=await account('/requests');assert.equal(own.status,200);const body=await own.json();assert.ok(body.items.some((r:{id:string})=>r.id===value.submissionId));assert.ok(body.items.every((r:{id:string})=>r.id!==guest));
  for(const forbidden of ['assignedAdmin','assigned_admin','customer_profile','staff','audit'])assert.ok(!JSON.stringify(body).includes(forbidden));
  await assert.rejects(f.customerRuntime.pool.query('SELECT role FROM admin_users'));await assert.rejects(f.customerRuntime.pool.query('UPDATE product_enquiries SET status=\'CLOSED\''));
  assert.match(own.headers.get('cache-control')!,/no-store/);
});
test("profile changes preserve verified identity and previous request contacts", async () => {
  const value=input();await submitRequest(value,f.customerRuntime,f.customerHeaders);
  const updated=await account('/details',f.customerHeaders,'POST',{name:'Updated Local Name',phone:'+442079460123'});assert.equal(updated.status,200);
  assert.equal((await updated.json()).profile.email,f.customerEmail);
  assert.equal((await f.data.query('SELECT contact_name FROM product_enquiries WHERE id=$1',[value.submissionId])).rows[0].contact_name,value.name);
  assert.equal((await account('/details',f.customerHeaders,'POST',{name:'Updated Local Name',email:'forged@boutique.test'})).status,400);
});
test("logout, revoked cookies and expired sessions cannot access private account data", async () => {
  const user=await f.customerSignIn();assert.equal((await account('',user.headers)).status,200);
  assert.equal((await f.customerAuth('sign-out',{},user.headers.get('Cookie')!)).status,200);assert.equal((await account('',user.headers)).status,401);
  const next=await f.customerSignIn();const c=await requireCustomer(next.headers,f.customerRuntime);await f.data.query("UPDATE customer_auth_sessions SET expires_at=now()-INTERVAL '1 second' WHERE id=$1",[c.sessionId]);assert.equal((await account('',next.headers)).status,401);
});
test("return destinations permit only validated public selection context",()=>{
  const valid='/contact?intent=QUOTATION&product=sample-ring&variant=00000000-0000-4000-8000-000000000001';assert.equal(customerReturn(valid),valid);
  for(const url of ['//evil.test','https://evil.test','/\\evil.test','/contact?email=private@boutique.test','/contact?intent=BESPOKE&product=ring','/account/sign-in','/contact?product=x&product=y','/contact#secret','/contact?intent=QUOTATION'])assert.equal(customerReturn(url),'/account');
});
test("independent runtimes share resend limits and concurrent correct verification consumes a code once",async()=>{
 const peer=createCustomerRuntime(f.customerConfig,async message=>{f.emails.push(message);});
 try{
  const email=`concurrent-${randomUUID()}@boutique.test`;
  const request=()=>new Request(f.customerConfig.baseURL+'/api/customer-auth/send-code',{method:'POST',headers:{Origin:f.customerConfig.baseURL,'Content-Type':'application/json'},body:JSON.stringify({email})});
  const sent=await Promise.all([customerAuthHttp(request(),f.customerRuntime),customerAuthHttp(request(),peer)]);assert.deepEqual(sent.map(r=>r.status).sort(),[200,429]);
  const code=f.emails.filter(m=>m.email===email).at(-1)!.otp;
  const verify=(runtime:typeof peer)=>customerAuthHttp(new Request(f.customerConfig.baseURL+'/api/customer-auth/verify-code',{method:'POST',headers:{Origin:f.customerConfig.baseURL,'Content-Type':'application/json'},body:JSON.stringify({email,code,name:'Concurrent Local Customer'})}),runtime);
  const verified=await Promise.all([verify(peer),verify(f.customerRuntime)]);assert.deepEqual(verified.map(r=>r.status).sort(),[200,400]);
  assert.equal((await f.data.query('SELECT count(*) FROM customer_auth_sessions s JOIN customer_auth_users u ON u.id=s.user_id WHERE u.email=$1',[email])).rows[0].count,'1');
 }finally{await peer.pool.end();}
});
test("failed session revocation never acknowledges logout or exposes token data",async()=>{
 const user=await f.customerSignIn();await f.data.query(`REVOKE DELETE ON customer_auth_sessions FROM "${f.customerRole}"`);
 try{const response=await f.customerAuth('sign-out',{},user.headers.get('Cookie')!);assert.equal(response.status,503);assert.ok(!response.headers.has('set-cookie'));assert.ok(!(await response.text()).includes(user.headers.get('Cookie')!));}
 finally{await f.data.query(`GRANT DELETE ON customer_auth_sessions TO "${f.customerRole}"`);}
});

test("resending rotates the code and failed delivery removes its verification record",async()=>{
 const email=`rotate-${randomUUID()}@boutique.test`;
 assert.equal((await f.customerAuth('send-code',{email})).status,200);const original=f.emails.at(-1)!.otp;
 await f.data.query("UPDATE customer_auth_rate_limits SET expires_at=now()-interval '1 second'");
 assert.equal((await f.customerAuth('send-code',{email})).status,200);const replacement=f.emails.at(-1)!.otp;
 assert.ok(original!==replacement,'A resend must rotate the one-time code.');
 assert.equal((await f.customerAuth('verify-code',{email,code:original,name:'Local Rotation Customer'})).status,400);
 assert.equal((await f.customerAuth('verify-code',{email,code:replacement,name:'Local Rotation Customer'})).status,200);
 const failure=`delivery-failure-${randomUUID()}@boutique.test`;f.delivery.fails=true;
 try{assert.equal((await f.customerAuth('send-code',{email:failure})).status,503);assert.equal((await f.data.query('SELECT count(*) FROM customer_auth_verifications WHERE identifier=$1',['sign-in-otp-'+failure])).rows[0].count,'0');}finally{f.delivery.fails=false;}
});

test("owned appointments expose confirmed public destinations and reject forged ownership",async()=>{
 const value=input({kind:'CONSULTATION',channel:'BOUTIQUE',preferredDate:'2030-02-10',preferredTime:'14:00'});await submitRequest(value,f.customerRuntime,f.customerHeaders);
 const own=await account('/appointments/'+value.submissionId);assert.equal(own.status,200);const pending=(await own.json()).items[0];assert.equal(pending.channel,'BOUTIQUE');assert.ok(pending.preferredStart);assert.equal(pending.boutiqueLocation,null);
 const location=randomUUID();await f.data.query("INSERT INTO boutique_locations(id,name,governorate,city_area,street_address,is_active) VALUES($1,'Local Verified Boutique','Cairo','Local area','Local fixture street',true)",[location]);
 await f.data.query("UPDATE appointment_requests SET status='CONFIRMED',confirmed_start_at='2030-02-10T12:00:00Z',boutique_location_id=$2,assigned_admin_id=$3 WHERE id=$1",[value.submissionId,location,f.users.ADMIN.id]);
 const confirmed=(await (await account('/appointments/'+value.submissionId)).json()).items[0];assert.equal(confirmed.status,'CONFIRMED');assert.ok(confirmed.confirmedStart);assert.equal(confirmed.boutiqueLocation.name,'Local Verified Boutique');assert.ok(!JSON.stringify(confirmed).includes(f.users.ADMIN.id));assert.ok(!('boutiqueLocationId' in confirmed));
 const other=await f.customerSignIn();assert.equal((await account('/appointments/'+value.submissionId,other.headers)).status,404);assert.equal((await (await account('/appointments',other.headers)).json()).items.length,0);
 await assert.rejects(submitRequest({...input(),customerProfileId:randomUUID()},f.customerRuntime,f.customerHeaders),{status:400});
 await assert.rejects(f.customerRuntime.pool.query('DELETE FROM appointment_requests WHERE id=$1',[value.submissionId]));
});
