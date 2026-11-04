import assert from 'node:assert/strict';
import { after,before,test } from 'node:test';
import { randomBytes,randomUUID,createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp,readFile,writeFile,rm } from 'node:fs/promises';
import { join,resolve,sep } from 'node:path';
import { tmpdir } from 'node:os';
import pg from 'pg';
import { orderFixture,fixtureOrder } from './helpers/order-fixture.mts';
import { sessionCookie } from './helpers/admin-fixture.mts';
import { product } from './helpers/catalogue-fixture.mts';
import { paymentEnvironment,signedTransaction,transactionFixture } from './helpers/paymob-mock.mts';
import { databaseConfig,isLoopback } from '../src/lib/db/config.ts';
import { withDatabaseClient,closeDatabase } from '../src/lib/db/client.ts';
import { adminConfiguration } from '../src/lib/admin/config.ts';
import { createAdminRuntime } from '../src/lib/admin/runtime.ts';
import { handleAdminAuth } from '../src/lib/admin/http.ts';
import { saveProduct } from '../src/lib/admin/catalogue/products.ts';
import { getPublishedProducts } from '../src/lib/catalogue/repository.ts';
import { ordersHttp } from '../src/lib/admin/orders/http.ts';
import { paymentHttp } from '../src/lib/payments/http.ts';
import { systemMediaCleanup } from '../src/lib/media/cleanup.ts';
import type { MediaProvider } from '../src/lib/media/cloudinary.ts';
import { developmentId } from '../db/tools/seed.ts';
import type { AdminOrder } from '../src/lib/admin/orders/types.ts';

const app='lapalme_staging_app',oldNames=['catalogue','admin','cart','payment','media_cleanup','backup'] as const;
const oldRoles=oldNames.map(n=>'lapalme_staging_'+n),password=randomBytes(32).toString('base64url');
const oldPasswords=Object.fromEntries(oldNames.map(n=>['PHASE11F_PASSWORD_'+n.toUpperCase(),randomBytes(32).toString('base64url')]));
const bin=process.env.PG_BIN??(process.platform==='win32'?'C:/Program Files/PostgreSQL/18/bin':'/usr/lib/postgresql/18/bin');
let base:Awaited<ReturnType<typeof orderFixture>>,f:Awaited<ReturnType<typeof orderFixture>>,runtime:ReturnType<typeof createAdminRuntime>,pool:pg.Pool,root:string,url:string,oldSnapshot:string;
let sixCreated=false,appCreated=false,rollbackVerified=false,lockVerified=false;
const saved=new Map<string,string|undefined>();
async function plan(path:string,local=true){
  const c=databaseConfig(base.ownerUrl);
  const env={...Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^PG|^PHASE11F_/i.test(k))),NODE_ENV:process.env.NODE_ENV,
    PGHOST:'127.0.0.1',PGPORT:String(c.port),PGDATABASE:c.database,PGUSER:c.user,PGPASSWORD:c.password as string,PGSSLMODE:'disable',
    ...oldPasswords,PHASE11F_APP_PASSWORD:password};
  const r=spawnSync(join(bin,process.platform==='win32'?'psql.exe':'psql'),['-X','--no-password','--set=ON_ERROR_STOP=1','--set=local_rehearsal='+local,'--file='+path],{env,encoding:'utf8',timeout:60000,windowsHide:true});
  // Do not forward raw SQL/diagnostics, which may contain synthetic secrets.
  return {status:r.status,guard:(r.stdout??'').includes('STOP:'),injected:(r.stderr??'').includes('simplification_missing_table')};
}
async function snapshotOld(){
  const roles=(await base.data.query('SELECT rolname,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolbypassrls,rolreplication,rolinherit,rolpassword FROM pg_authid WHERE rolname=ANY($1) ORDER BY rolname',[oldRoles])).rows;
  const grants=(await base.data.query("SELECT kind,obj,r.rolname,a.privilege_type,a.is_grantable FROM (SELECT 'table' kind,c.relname obj,a.* FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE n.nspname='public' UNION ALL SELECT 'column',c.relname||'.'||x.attname,a.* FROM pg_attribute x JOIN pg_class c ON c.oid=x.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(x.attacl) a WHERE n.nspname='public' UNION ALL SELECT 'schema',n.nspname,a.* FROM pg_namespace n CROSS JOIN LATERAL aclexplode(n.nspacl) a UNION ALL SELECT 'database',d.datname,a.* FROM pg_database d CROSS JOIN LATERAL aclexplode(d.datacl) a) a JOIN pg_roles r ON r.oid=a.grantee WHERE r.rolname=ANY($1) ORDER BY kind,obj,r.rolname,a.privilege_type",[oldRoles])).rows;
  const memberships=(await base.data.query('SELECT a.* FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.member OR r.oid=a.roleid WHERE r.rolname=ANY($1) ORDER BY a.roleid,a.member',[oldRoles])).rows;
  const settings=(await base.data.query('SELECT s.* FROM pg_db_role_setting s JOIN pg_roles r ON r.oid=s.setrole WHERE r.rolname=ANY($1) ORDER BY s.setrole,s.setdatabase',[oldRoles])).rows;
  return JSON.stringify({roles,grants,memberships,settings});
}
before(async()=>{
  const c=databaseConfig(process.env.TEST_DATABASE_URL);
  assert.ok(process.env.TEST_DATABASE_URL&&isLoopback(c.host??'')&&process.env.NODE_ENV!=='production','Use an exclusive disposable loopback PostgreSQL18.6 cluster.');
  assert.equal(new Set([password,...Object.values(oldPasswords)]).size,7);
  base=await orderFixture();root=await mkdtemp(join(tmpdir(),'lapalme-app-role-'));
  // Model the already-provisioned six identities locally; never execute this on Neon.
  assert.equal((await plan(resolve('infra/neon/staging-runtime-roles.review.sql'))).status,0);sixCreated=true;
  oldSnapshot=await snapshotOld();
  const source=await readFile('infra/neon/staging-app-role.review.sql','utf8');
  const lock=await base.data.connect();
  try{await lock.query('SELECT pg_advisory_lock(1279348813,7)');const r=await plan(resolve('infra/neon/staging-app-role.review.sql'));assert.notEqual(r.status,0);assert.ok(r.guard);lockVerified=true;}
  finally{await lock.query('SELECT pg_advisory_unlock(1279348813,7)');lock.release();}
  const broken=join(root,'rollback.sql');await writeFile(broken,source.replace('GRANT CONNECT ON DATABASE','GRANT SELECT ON simplification_missing_table TO lapalme_staging_app;\nGRANT CONNECT ON DATABASE'));
  const failed=await plan(broken);assert.notEqual(failed.status,0);assert.ok(failed.injected);
  assert.equal((await base.data.query('SELECT count(*)::int n FROM pg_roles WHERE rolname=$1',[app])).rows[0].n,0);rollbackVerified=true;
  assert.equal((await plan(resolve('infra/neon/staging-app-role.review.sql'))).status,0);appCreated=true;
  assert.ok(oldSnapshot===await snapshotOld(),'Existing six local identities and their credentials/grants must be unchanged.');
  const u=new URL(base.ownerUrl);u.username=app;u.password=password;url=u.toString();pool=new pg.Pool(databaseConfig(url));
  const values={DATABASE_URL:url,ADMIN_DATABASE_URL:url,CART_DATABASE_URL:url,PAYMENT_DATABASE_URL:url,MEDIA_CLEANUP_DATABASE_URL:url,
    BETTER_AUTH_URL:base.authConfig.baseURL,BETTER_AUTH_SECRET:base.authConfig.secret};
  for(const[k,v]of Object.entries(values)){saved.set(k,process.env[k]);process.env[k]=v;}
  runtime=createAdminRuntime(adminConfiguration());
  f={...base,runtime,authConfig:runtime.config,cartUrl:url,paymentUrl:url,readerUrl:url};
},{timeout:90000});
after(async()=>{
  await closeDatabase();await runtime?.pool.end();await pool?.end();
  try{if(base){if(appCreated){await base.data.query('DROP OWNED BY '+app);await base.data.query('DROP ROLE '+app);}if(sixCreated)for(const name of oldRoles){await base.data.query('DROP OWNED BY '+name);await base.data.query('DROP ROLE '+name);}}}
  finally{await base?.close();for(const[k,v]of saved){if(v===undefined)delete process.env[k];else process.env[k]=v;}if(root){assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep)&&root.includes('lapalme-app-role-'));await rm(root,{recursive:true,force:true});}}
});
async function denied(sql:string){
  const c=await pool.connect();try{await c.query('BEGIN');await assert.rejects(c.query(sql),(e:unknown)=>!!e&&typeof e==='object'&&'code' in e&&e.code==='42501');}
  finally{await c.query('ROLLBACK');c.release();}
}
async function headers(which:'OWNER'|'ADMIN'|'CATALOGUE_MANAGER'='OWNER'){
  const r=await handleAdminAuth(new Request(f.authConfig.baseURL+'/api/admin-auth/sign-in/email',{method:'POST',headers:{Origin:f.authConfig.baseURL,'Content-Type':'application/json'},body:JSON.stringify({email:f.users[which].email,password:f.password})}),runtime);
  assert.equal(r.status,200);return new Headers({Cookie:sessionCookie(r)});
}
async function request(id:string,h:Headers,body?:unknown,origin=f.authConfig.baseURL){
  const hh=new Headers(h);hh.set('Origin',origin);hh.set('Content-Type','application/json');
  const r=await ordersHttp(new Request(f.authConfig.baseURL+'/api/admin/orders/'+id,{method:body===undefined?'GET':'POST',headers:hh,...(body===undefined?{}:{body:JSON.stringify(body)})}),[id],runtime);
  return {status:r.status,body:await r.json()};
}
async function operation(id:string,h:Headers,action:string,extra:Record<string,unknown>={}){
  const detail=await request(id,h);assert.equal(detail.status,200);
  return request(id,h,{action,revision:detail.body.order.revision,operationId:randomUUID(),...extra});
}
test('all four actual application pools authenticate as the same restricted SCRAM identity',async()=>{
  for(const access of ['catalogue','cart','payment'] as const)assert.equal(await withDatabaseClient(async c=>(await c.query('SELECT current_user')).rows[0].current_user,access),app);
  assert.equal((await runtime.pool.query('SELECT current_user')).rows[0].current_user,app);
  assert.equal(databaseConfig(url).max,4);
  const bad=new URL(url);bad.password=randomBytes(32).toString('base64url');const badPool=new pg.Pool(databaseConfig(bad.toString()));
  try{await assert.rejects(badPool.query('SELECT 1'),(e:unknown)=>!!e&&typeof e==='object'&&'code' in e&&e.code==='28P01','The app identity requires SCRAM host authentication.');}finally{await badPool.end();}
});
test('transaction rollback, lock contention, wrong target and replay fail safely',async()=>{
  assert.ok(rollbackVerified&&lockVerified);
  for(const local of [false,true]){const r=await plan(resolve('infra/neon/staging-app-role.review.sql'),local);assert.notEqual(r.status,0);assert.ok(r.guard);}
  assert.ok(oldSnapshot===await snapshotOld(),'Existing identities must not change on rejected attempts.');
});
test('the new identity has no administrative attributes, membership, ownership, persistent CREATE or sequences',async()=>{
  const r=(await pool.query("SELECT r.rolcanlogin AND NOT r.rolsuper AND NOT r.rolcreatedb AND NOT r.rolcreaterole AND NOT r.rolbypassrls AND NOT r.rolreplication AND NOT r.rolinherit AS safe, NOT EXISTS(SELECT FROM pg_auth_members WHERE member=r.oid) AS memberships, NOT EXISTS(SELECT FROM pg_class WHERE relowner=r.oid) AND NOT EXISTS(SELECT FROM pg_namespace WHERE nspowner=r.oid) AND NOT EXISTS(SELECT FROM pg_database WHERE datdba=r.oid) AS ownership,has_schema_privilege(current_user,'public','CREATE') AS schema_create,has_database_privilege(current_user,current_database(),'CREATE') AS db_create FROM pg_roles r WHERE rolname=current_user")).rows[0];
  assert.deepEqual(r,{safe:true,memberships:true,ownership:true,schema_create:false,db_create:false});
  assert.equal((await pool.query("SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='S'")).rows[0].n,0);
});
// Independent expected union of the documented service contracts; backup is excluded.
const tableGrants=new Map<string,Set<string>>(),columnGrants=new Map<string,Set<string>>();
function allow(priv:string,tables:string){for(const t of tables.split(',')){const set=tableGrants.get(t)??new Set<string>();priv.split(',').forEach(p=>set.add(p));tableGrants.set(t,set);}}
function columns(table:string,names:string){columnGrants.set(table,new Set(names.split(',')));}
allow('SELECT','categories,collections,products,product_categories,product_collections,product_variants,product_prices,product_media,gemstones,product_gemstones,inventory,admin_users,admin_auth_accounts,admin_auth_sessions,admin_auth_verifications,admin_auth_rate_limits,audit_events,catalogue_media_jobs,carts,cart_items,cart_rate_limits,checkout_drafts,boutique_locations,orders,order_items,order_addresses,payments,payment_events,inventory_reservations,order_status_history,fulfillment_arrangements,fulfillment_events');
allow('INSERT','admin_auth_sessions,admin_auth_rate_limits,audit_events,products,product_variants,product_prices,inventory,gemstones,product_categories,product_collections,product_gemstones,product_media,catalogue_media_jobs,fulfillment_arrangements,fulfillment_events,order_status_history,carts,cart_items,cart_rate_limits,checkout_drafts,orders,order_items,order_addresses,payments,payment_events,inventory_reservations');
allow('UPDATE','admin_auth_rate_limits,products,product_variants,product_prices,inventory,product_categories,product_collections,product_gemstones,product_media,catalogue_media_jobs,carts,cart_items,cart_rate_limits,checkout_drafts');
allow('DELETE','admin_auth_sessions,admin_auth_rate_limits,product_categories,product_collections,product_gemstones,product_media,cart_items,cart_rate_limits,checkout_drafts');
columns('admin_users','updated_at');columns('boutique_locations','updated_at');
columns('orders','fulfillment_status,order_status,payment_status,inventory_finalized_at,reconciliation_required,reconciliation_reason,updated_at');
columns('fulfillment_arrangements','status,scheduled_start_at,scheduled_end_at,assigned_admin_id,completed_at,completed_by_admin_id,updated_at');
columns('payments','provider_order_reference,provider_intention_reference,provider_transaction_reference,status,succeeded_at,initiation_state,checkout_client_secret,checkout_resume_until,next_reconcile_at,reconcile_lease_until,reconcile_attempts,last_error_code,updated_at');
columns('payment_events','payment_id,status,processing_attempts,last_error_code,processed_at');columns('inventory_reservations','status,ended_at,updated_at');
test('effective table and column privileges equal the exact combined scope, without grant options',async()=>{
  assert.equal(tableGrants.size,32);
  const ts=await pool.query("SELECT c.relname t,p,has_table_privilege(current_user,c.oid,p) allowed,has_table_privilege(current_user,c.oid,p||' WITH GRANT OPTION') grantable FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p WHERE n.nspname='public' AND c.relkind='r'");
  assert.equal(ts.rows.length,38*8);for(const r of ts.rows){assert.equal(r.allowed,tableGrants.get(r.t)?.has(r.p)??false,r.t+':'+r.p);assert.equal(r.grantable,false);}
  const cs=await pool.query("SELECT c.relname t,a.attname col,p,has_column_privilege(current_user,c.oid,a.attnum,p) allowed,has_column_privilege(current_user,c.oid,a.attnum,p||' WITH GRANT OPTION') grantable FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) p WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped");
  assert.equal(cs.rows.length,419*4);for(const r of cs.rows){assert.equal(r.allowed,!!(tableGrants.get(r.t)?.has(r.p)||(r.p==='UPDATE'&&columnGrants.get(r.t)?.has(r.col))),r.t+':'+r.col+':'+r.p);assert.equal(r.grantable,false);}
});
test('DDL, role creation/escalation, ledger access and unrelated objects are denied by actual SQL',async()=>{
  for(const sql of ['CREATE TABLE public.app_forbidden(id integer)','ALTER TABLE public.products ADD COLUMN app_forbidden text','DROP TABLE public.products','CREATE SCHEMA app_forbidden','ALTER SCHEMA public RENAME TO app_forbidden','DROP SCHEMA public CASCADE','CREATE ROLE app_forbidden NOLOGIN','SET ROLE postgres',
    'SELECT * FROM public.schema_migrations',"INSERT INTO public.schema_migrations(version,filename) SELECT '9999','app_forbidden' WHERE false",'UPDATE public.schema_migrations SET filename=filename WHERE false','DELETE FROM public.schema_migrations WHERE false','TRUNCATE public.schema_migrations',
    'UPDATE public.admin_users SET role=role WHERE false','UPDATE public.admin_auth_accounts SET password=password WHERE false','UPDATE public.orders SET total_minor=total_minor WHERE false','UPDATE public.payments SET amount_minor=amount_minor WHERE false','DELETE FROM public.payments WHERE false','UPDATE public.audit_events SET action=action WHERE false','DELETE FROM public.audit_events WHERE false','DELETE FROM public.order_status_history WHERE false'])await denied(sql);
  for(const t of ['customer_profiles','customer_addresses','bespoke_requests','appointment_requests','product_enquiries'])await denied('SELECT * FROM public.'+t);
});
test('Better Auth and catalogue administration work while public reads still filter drafts',async()=>{
  const owner=await headers(),manager=await headers('CATALOGUE_MANAGER');
  const id=await saveProduct(owner,null,{product:product('Combined runtime draft'),action:'save'},runtime);assert.ok(id);
  assert.ok(await saveProduct(manager,null,{product:product('Combined manager draft'),action:'save'},runtime));
  const published=await getPublishedProducts();assert.ok(published.items.length>0);assert.ok(!published.items.some(p=>p.id===id));
  const bad=await handleAdminAuth(new Request(f.authConfig.baseURL+'/api/admin-auth/sign-in/email',{method:'POST',headers:{Origin:'https://untrusted.test','Content-Type':'application/json'},body:JSON.stringify({email:f.users.OWNER.email,password:f.password})}),runtime);assert.equal(bad.status,403);
});
test('real carts and checkout drafts create a reservation, verified HMAC consumes it once, and replay is idempotent',{timeout:60000},async()=>{
  const a=await fixtureOrder(f,'PRIVATE_DELIVERY',false);
  const before=(await pool.query('SELECT on_hand,reserved FROM inventory WHERE variant_id=$1',[developmentId(202)])).rows[0];assert.deepEqual(before,{on_hand:100,reserved:1});
  assert.equal((await pool.query('SELECT status FROM inventory_reservations WHERE order_id=$1',[a.id])).rows[0].status,'ACTIVE');
  const p=(await pool.query('SELECT provider_order_reference,amount_minor FROM payments WHERE order_id=$1',[a.id])).rows[0];
  const event=signedTransaction(transactionFixture(p.provider_order_reference,Number(p.amount_minor),{id:Number(p.provider_order_reference)+1000000000}));
  const values={...paymentEnvironment,CART_DATABASE_URL:url,PAYMENT_DATABASE_URL:url,CART_ORIGIN:f.authConfig.baseURL,CHECKOUT_DRAFT_RETENTION_READY:'true'};
  const previous=new Map(Object.keys(values).map(k=>[k,process.env[k]]));Object.assign(process.env,values);
  try{
    const callback=(signature=event.signature)=>paymentHttp(new Request(f.authConfig.baseURL+'/api/payments/paymob/callback?hmac='+signature,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(event.body)}),['paymob','callback']);
    assert.equal((await callback('0'.repeat(128))).status,401);
    assert.deepEqual((await pool.query('SELECT on_hand,reserved FROM inventory WHERE variant_id=$1',[developmentId(202)])).rows[0],before);
    assert.equal((await callback()).status,200);assert.equal((await callback()).status,200);
    assert.deepEqual((await pool.query('SELECT on_hand,reserved FROM inventory WHERE variant_id=$1',[developmentId(202)])).rows[0],{on_hand:99,reserved:0});
    assert.equal((await pool.query('SELECT status FROM inventory_reservations WHERE order_id=$1',[a.id])).rows[0].status,'CONSUMED');
    assert.equal((await pool.query('SELECT payment_status FROM orders WHERE id=$1',[a.id])).rows[0].payment_status,'PAID');
  }finally{for(const[k,v]of previous){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});
test('guest privacy, human authorization, Origin checks and complete fulfillment remain enforced with the shared identity',{timeout:60000},async()=>{
  const a=await fixtureOrder(f),b=await fixtureOrder(f),owner=await headers(),manager=await headers('CATALOGUE_MANAGER');
  assert.equal((await a.customer()).status,200);assert.equal((await a.customer(b.session)).status,404);assert.equal((await a.customer('')).status,404);
  assert.equal((await request(a.id,new Headers())).status,401);assert.equal((await request(a.id,manager)).status,403);
  assert.equal((await request(a.id,owner,{action:'prepare'},'https://untrusted.test')).status,403);
  const before=(await pool.query('SELECT total_minor,payment_status,inventory_finalized_at FROM orders WHERE id=$1',[a.id])).rows[0];
  for(const action of ['prepare','contact'])assert.equal((await operation(a.id,owner,action)).status,200);
  assert.equal((await operation(a.id,owner,'propose',{start:new Date(Date.now()+86400000).toISOString(),end:new Date(Date.now()+90000000).toISOString()})).status,200);
  assert.equal((await operation(a.id,owner,'confirm',{confirmed:true,assignedAdminId:f.users.ADMIN.id})).status,200);
  assert.equal((await operation(a.id,owner,'dispatch')).status,200);
  assert.equal((await operation(a.id,owner,'complete',{confirmed:true,recipient:'Synthetic combined-role recipient',occurredAt:new Date().toISOString(),notes:'Local combined-role fixture.'})).status,200);
  const detail=await request(a.id,owner);assert.equal((detail.body.order as AdminOrder).fulfillmentStatus,'COMPLETED');
  assert.deepEqual((await pool.query('SELECT total_minor,payment_status,inventory_finalized_at FROM orders WHERE id=$1',[a.id])).rows[0],before);
});
test('existing operator media cleanup works with the combined role and append-only audit',async()=>{
  const id=randomUUID(),publicId='la-palme/catalogue/'+developmentId(102)+'/'+randomUUID();
  await base.data.query("INSERT INTO catalogue_media_jobs(id,product_id,public_id,state,available_at) VALUES($1,$2,$3,'DELETE_PENDING',now()-INTERVAL '1 minute')",[id,developmentId(102),publicId]);
  const destroyed:string[]=[],provider={destroy:async(id:string)=>{destroyed.push(id);}} as unknown as MediaProvider;
  assert.equal((await systemMediaCleanup(pool,provider,1)).completed,1);assert.deepEqual(destroyed,[publicId]);
  assert.equal((await pool.query("SELECT count(*)::int n FROM audit_events WHERE action='CATALOGUE_MEDIA_CLEANED'")).rows[0].n,1);
});
test('all six prior identities, their grants and local credentials remain unchanged; migration artifacts stay pinned',async()=>{
  assert.ok(oldSnapshot===await snapshotOld(),'Preserve every pre-existing role setting, credential verifier and effective grant.');
  assert.equal(createHash('sha256').update(await readFile('infra/neon/staging-runtime-roles.review.sql')).digest('hex'),'459692b229613cb0cf168d2ea05222ed6bad759d9c82cb40957cc30521d436ce');
  const manifest=JSON.parse(await readFile('infra/cloud-run/migrations.sha256.json','utf8')) as {filename:string;sha256:string}[];
  assert.equal(manifest.length,12);for(const m of manifest)assert.equal(createHash('sha256').update(await readFile('db/migrations/'+m.filename)).digest('hex'),m.sha256);
});

