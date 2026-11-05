// Exercise retained direct-sales behavior; quotation-only denial has its own suites.
process.env.COMMERCE_MODE = "DIRECT_SALES";
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
import { databaseConfig,isLoopback } from '../src/lib/db/config.ts';
import { closeDatabase } from '../src/lib/db/client.ts';
import { runMigrations } from '../db/tools/migrate.ts';
import { createAdminRuntime } from '../src/lib/admin/runtime.ts';
import { handleAdminAuth } from '../src/lib/admin/http.ts';
import { saveProduct } from '../src/lib/admin/catalogue/products.ts';
import { ordersHttp } from '../src/lib/admin/orders/http.ts';
import { systemMediaCleanup } from '../src/lib/media/cleanup.ts';
import type { MediaProvider } from '../src/lib/media/cloudinary.ts';
import { backupDatabase } from '../db/tools/backup.ts';
import { developmentId } from '../db/tools/seed.ts';
import { getPublishedProducts } from '../src/lib/catalogue/repository.ts';

const names=['catalogue','admin','cart','payment','media_cleanup','backup'] as const;
type Name=typeof names[number];
const role=(n:Name)=>'lapalme_staging_'+n;
const passwords=Object.fromEntries(names.map(n=>[n,randomBytes(32).toString('base64url')])) as Record<Name,string>;
const pools={} as Record<Name,pg.Pool>,urls={} as Record<Name,string>;
const bin=process.env.PG_BIN??'/usr/lib/postgresql/18/bin';
let base:Awaited<ReturnType<typeof orderFixture>>,runtime:ReturnType<typeof createAdminRuntime>,root:string,rollbackVerified=false,lockVerified=false,provisioned=false;
async function plan(path:string,local=true){
  const c=databaseConfig(base.ownerUrl);
  const env={...Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^PG|^PHASE11F_/i.test(k))),
    NODE_ENV:process.env.NODE_ENV,PGHOST:'127.0.0.1',PGPORT:String(c.port),PGDATABASE:c.database,PGUSER:c.user,PGPASSWORD:c.password as string,PGSSLMODE:'disable',
    ...Object.fromEntries(names.map(n=>['PHASE11F_PASSWORD_'+n.toUpperCase(),passwords[n]]))};
  // Capture, never forward raw SQL/error output containing synthetic credentials.
  const r=spawnSync(join(bin,'psql'),['-X','--no-password','--set=ON_ERROR_STOP=1','--set=local_rehearsal='+local,'--file='+path],{env,encoding:'utf8',timeout:60000,windowsHide:true});
  return {status:r.status,guardRejected:(r.stdout??'').includes('STOP:'),created:(r.stdout??'').includes('Six restricted identities provisioned.'),injectedFailure:(r.stderr??'').includes('nonexistent_phase11f_table')};
}
before(async()=>{
  const c=databaseConfig(process.env.TEST_DATABASE_URL);
  assert.ok(process.env.TEST_DATABASE_URL&&isLoopback(c.host??'')&&process.env.NODE_ENV!=='production','Disposable loopback cluster only.');
  base=await orderFixture(undefined,12);root=await mkdtemp(join(tmpdir(),'lapalme-runtime-roles-'));
  const lock=await base.data.connect();
  try{await lock.query('SELECT pg_advisory_lock(1279348813,6)');const r=await plan(resolve('infra/neon/staging-runtime-roles.review.sql'));assert.notEqual(r.status,0);assert.ok(r.guardRejected);lockVerified=true;}
  finally{await lock.query('SELECT pg_advisory_unlock(1279348813,6)');lock.release();}
  const source=await readFile('infra/neon/staging-runtime-roles.review.sql','utf8'),broken=join(root,'rollback.sql');
  await writeFile(broken,source.replace('GRANT CONNECT ON DATABASE','GRANT SELECT ON nonexistent_phase11f_table TO lapalme_staging_catalogue;\nGRANT CONNECT ON DATABASE'));
  const failed=await plan(broken);assert.notEqual(failed.status,0);assert.ok(failed.injectedFailure);
  assert.equal((await base.data.query('SELECT count(*)::int n FROM pg_roles WHERE rolname=ANY($1)',[names.map(role)])).rows[0].n,0);
  rollbackVerified=true;
  assert.deepEqual(await plan(resolve('infra/neon/staging-runtime-roles.review.sql')),{status:0,guardRejected:false,created:true,injectedFailure:false});
  provisioned=true;
  assert.equal((await base.data.query('SELECT count(*)::int n FROM schema_migrations')).rows[0].n,12);
  assert.deepEqual(await runMigrations(base.ownerUrl),['0013_quotation_requests_specifications.sql']);
  for(const n of names){const u=new URL(base.ownerUrl);u.username=role(n);u.password=passwords[n];urls[n]=u.toString();pools[n]=new pg.Pool(databaseConfig(urls[n]));}
  runtime=createAdminRuntime({...base.authConfig,databaseUrl:urls.admin});
},{timeout:90000});
after(async()=>{
  await closeDatabase();await runtime?.pool.end();await Promise.all(Object.values(pools).map(p=>p.end()));
  if(base){if(provisioned)for(const n of names){await base.data.query('DROP OWNED BY '+role(n));await base.data.query('DROP ROLE '+role(n));}await base.close();}
  if(root){assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep)&&root.includes('lapalme-runtime-roles-'));await rm(root,{recursive:true,force:true});}
});
async function denied(pool:pg.Pool,sql:string){
  const c=await pool.connect();
  try{await c.query('BEGIN');await assert.rejects(c.query(sql),(e:unknown)=>!!e&&typeof e==='object'&&'code' in e&&e.code==='42501');}
  finally{await c.query('ROLLBACK');c.release();}
}
async function headers(which:'OWNER'|'ADMIN'|'CATALOGUE_MANAGER'='OWNER'){
  const response=await handleAdminAuth(new Request(base.authConfig.baseURL+'/api/admin-auth/sign-in/email',{method:'POST',headers:{Origin:base.authConfig.baseURL,'Content-Type':'application/json'},body:JSON.stringify({email:base.users[which].email,password:base.password})}),runtime);
  assert.equal(response.status,200);return new Headers({Cookie:sessionCookie(response)});
}
test('migration source bytes retain all twelve accepted checksums',async()=>{
  const manifest=JSON.parse(await readFile('infra/cloud-run/migrations.sha256.json','utf8')) as {filename:string;sha256:string}[];
  assert.equal(manifest.length,13);
  const historical=manifest.slice(0,12),approved=await readFile('infra/neon/staging-runtime-roles.review.sql','utf8');
  assert.equal(historical.length,12);
  for(const m of historical){assert.ok(approved.includes("'"+m.filename+"','"+m.sha256+"'"));assert.equal(createHash('sha256').update(await readFile('db/migrations/'+m.filename)).digest('hex'),m.sha256);}
});
test('failed grants roll back role creation; replay and wrong-target guards refuse changes',async()=>{
  assert.ok(rollbackVerified);assert.ok(lockVerified);
  for(const local of [true,false]){const r=await plan(resolve('infra/neon/staging-runtime-roles.review.sql'),local);assert.notEqual(r.status,0);assert.ok(r.guardRejected);}
  assert.equal((await base.data.query('SELECT count(*)::int n FROM schema_migrations')).rows[0].n,13);
});
test('six actual LOGINs authenticate with separate SCRAM secrets and reject wrong passwords',async()=>{
  for(const n of names){
    assert.equal((await pools[n].query('SELECT current_user')).rows[0].current_user,role(n));
    const url=new URL(urls[n]);url.password=randomBytes(32).toString('base64url');
    const bad=new pg.Pool(databaseConfig(url.toString()));
    try{await assert.rejects(bad.query('SELECT 1'),(e:unknown)=>!!e&&typeof e==='object'&&'code' in e&&e.code==='28P01','This suite requires a SCRAM-authenticated local cluster.');}finally{await bad.end();}
  }
  assert.ok((await base.data.query('SELECT rolpassword FROM pg_authid WHERE rolname=ANY($1)',[names.map(role)])).rows.every(r=>/^SCRAM-SHA-256\$/.test(r.rolpassword)));
});
test('no runtime has administrative attributes, membership, ownership, persistent CREATE or sequences',async()=>{
  for(const n of names){
    const r=(await pools[n].query("SELECT r.rolcanlogin AND NOT r.rolsuper AND NOT r.rolcreatedb AND NOT r.rolcreaterole AND NOT r.rolbypassrls AND NOT r.rolreplication AND NOT r.rolinherit AS safe, NOT EXISTS(SELECT FROM pg_auth_members WHERE member=r.oid) AS memberships, NOT EXISTS(SELECT FROM pg_class WHERE relowner=r.oid) AND NOT EXISTS(SELECT FROM pg_namespace WHERE nspowner=r.oid) AND NOT EXISTS(SELECT FROM pg_database WHERE datdba=r.oid) AS ownership, has_schema_privilege(current_user,'public','USAGE') AS usage,has_schema_privilege(current_user,'public','CREATE') AS schema_create,has_database_privilege(current_user,current_database(),'CREATE') AS db_create FROM pg_roles r WHERE rolname=current_user")).rows[0];
    assert.deepEqual(r,{safe:true,memberships:true,ownership:true,usage:true,schema_create:false,db_create:false});
    if(n==='backup')assert.equal((await pools[n].query('SHOW default_transaction_read_only')).rows[0].default_transaction_read_only,'on');
    await pools[n].query('SET default_transaction_read_only=off');
    await denied(pools[n],'CREATE TABLE public.runtime_forbidden(id integer)');
    await denied(pools[n],'ALTER TABLE public.schema_migrations ADD COLUMN runtime_forbidden text');
    await denied(pools[n],'SET ROLE postgres');
    assert.equal((await pools[n].query("SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='S'")).rows[0].n,0);
  }
});
// Independent expected matrix from the documented cumulative service contracts.
// Exhaust every table and column, including private zero-grant tables and PG18 MAINTAIN.
type Contract={tables:Map<string,Set<string>>;columns:Map<string,Set<string>>};
const contracts=Object.fromEntries(names.map(n=>[n,{tables:new Map(),columns:new Map()}])) as Record<Name,Contract>;
function allow(n:Name,privileges:string,tables:string){for(const t of tables.split(',')){const p=contracts[n].tables.get(t)??new Set<string>();privileges.split(',').forEach(v=>p.add(v));contracts[n].tables.set(t,p);}}
function columns(n:Name,privilege:string,table:string,cols:string){contracts[n].columns.set(table+':'+privilege,new Set(cols.split(',')));}
allow('catalogue','SELECT','categories,collections,products,product_categories,product_collections,product_variants,product_prices,product_media,gemstones,product_gemstones,inventory');
allow('admin','SELECT','admin_users,admin_auth_accounts,admin_auth_sessions,admin_auth_verifications,categories,collections,audit_events,order_items,order_addresses,boutique_locations,fulfillment_arrangements,fulfillment_events,order_status_history');
allow('admin','INSERT,DELETE','admin_auth_sessions');
allow('admin','SELECT,INSERT,UPDATE,DELETE','admin_auth_rate_limits,product_categories,product_collections,product_gemstones,product_media');
allow('admin','SELECT,INSERT,UPDATE','products,product_variants,product_prices,inventory,catalogue_media_jobs');
allow('admin','SELECT,INSERT','gemstones');allow('admin','INSERT','audit_events,fulfillment_arrangements,fulfillment_events,order_status_history');
columns('admin','SELECT','orders','id,order_number,customer_name,customer_email,customer_phone,currency,total_minor,subtotal_minor,discount_minor,tax_minor,fulfillment_fee_minor,payment_status,order_status,fulfillment_method,fulfillment_status,created_at,updated_at,test_mode,boutique_location_id,boutique_location_snapshot,inventory_finalized_at,reconciliation_required,reconciliation_reason');
columns('admin','UPDATE','orders','fulfillment_status,order_status,updated_at');
columns('admin','UPDATE','admin_users','updated_at');columns('admin','UPDATE','boutique_locations','updated_at');
columns('admin','SELECT','payments','id,order_id,status,currency,amount_minor,refunded_minor,provider_transaction_reference,created_at,succeeded_at,initiation_state,last_error_code');
columns('admin','SELECT','payment_events','id,payment_id,status,signature_verified,verification_source,provider_transaction_reference,received_at,processed_at');
columns('admin','UPDATE','fulfillment_arrangements','status,scheduled_start_at,scheduled_end_at,assigned_admin_id,completed_at,completed_by_admin_id,updated_at');
allow('cart','SELECT','products,product_variants,product_prices,product_media,inventory,boutique_locations');
allow('cart','SELECT,INSERT,UPDATE','carts');allow('cart','SELECT,INSERT,UPDATE,DELETE','cart_items,cart_rate_limits,checkout_drafts');
allow('payment','SELECT','products,product_variants,product_prices,product_media,inventory,boutique_locations,carts,cart_items,checkout_drafts,orders,order_items,order_addresses,payments,payment_events,inventory_reservations,order_status_history');
allow('payment','INSERT','carts,orders,order_items,order_addresses,payments,payment_events,inventory_reservations,order_status_history');
allow('payment','DELETE','cart_items,checkout_drafts');allow('payment','SELECT,INSERT,UPDATE,DELETE','cart_rate_limits');
for(const t of ['products','product_variants','product_prices','boutique_locations'])columns('payment','UPDATE',t,'updated_at');
columns('payment','UPDATE','carts','status,session_token_hash,updated_at');columns('payment','UPDATE','cart_items','cart_id');
columns('payment','UPDATE','checkout_drafts','cart_id,updated_at');columns('payment','UPDATE','inventory','on_hand,reserved,updated_at');
columns('payment','UPDATE','orders','order_status,payment_status,inventory_finalized_at,reconciliation_required,reconciliation_reason,updated_at');
columns('payment','UPDATE','payments','provider_order_reference,provider_intention_reference,provider_transaction_reference,status,succeeded_at,initiation_state,checkout_client_secret,checkout_resume_until,next_reconcile_at,reconcile_lease_until,reconcile_attempts,last_error_code,updated_at');
columns('payment','UPDATE','inventory_reservations','status,ended_at,updated_at');columns('payment','UPDATE','payment_events','payment_id,status,processing_attempts,last_error_code,processed_at');
allow('media_cleanup','SELECT','catalogue_media_jobs');allow('media_cleanup','INSERT','audit_events');
columns('media_cleanup','UPDATE','catalogue_media_jobs','state,attempts,available_at,updated_at');columns('media_cleanup','SELECT','product_media','id,cloudinary_public_id');
test('effective privileges exactly match the six contracts across all tables and columns',async()=>{
  const tables=(await base.data.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(r=>r.tablename as string);
  assert.equal(tables.length,38);allow('backup','SELECT',tables.join(','));
  for(const n of names){
    const ts=await pools[n].query("SELECT c.relname t,p,has_table_privilege(current_user,c.oid,p) allowed FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p WHERE n.nspname='public' AND c.relkind='r'");
    for(const r of ts.rows)assert.equal(r.allowed,contracts[n].tables.get(r.t)?.has(r.p)??false,n+':'+r.t+':'+r.p);
    const cs=await pools[n].query("SELECT c.relname t,a.attname col,p,has_column_privilege(current_user,c.oid,a.attnum,p) allowed FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) p WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped");
    for(const r of cs.rows)assert.equal(r.allowed,!!(contracts[n].tables.get(r.t)?.has(r.p)||contracts[n].columns.get(r.t+':'+r.p)?.has(r.col)),n+':'+r.t+':'+r.col+':'+r.p);
  }
});
test('actual SQL denies private reads, financial edits, audit rewrites and migration changes',async()=>{
  for(const n of names){
    for(const sql of ["INSERT INTO public.schema_migrations(version,filename) SELECT '9999','runtime_forbidden' WHERE false",'UPDATE public.schema_migrations SET filename=filename WHERE false','DELETE FROM public.schema_migrations WHERE false','TRUNCATE public.schema_migrations'])await denied(pools[n],sql);
    if(n!=='backup')await denied(pools[n],'SELECT * FROM public.schema_migrations');
  }
  for(const t of ['customer_profiles','admin_users','carts','orders','payments'])await denied(pools.catalogue,'SELECT * FROM '+t);
  for(const t of ['admin_users','orders','payments','payment_events'])await denied(pools.cart,'SELECT * FROM '+t);
  for(const sql of ['UPDATE orders SET total_minor=total_minor WHERE false','UPDATE payments SET status=status WHERE false','SELECT checkout_client_secret FROM payments','SELECT verified_payload FROM payment_events','UPDATE audit_events SET action=action WHERE false','DELETE FROM audit_events WHERE false'])await denied(pools.admin,sql);
  for(const sql of ['UPDATE product_prices SET amount_minor=amount_minor WHERE false','UPDATE orders SET total_minor=total_minor WHERE false','DELETE FROM payments WHERE false','SELECT * FROM admin_auth_accounts'])await denied(pools.payment,sql);
  for(const sql of ['DELETE FROM product_media WHERE false','UPDATE catalogue_media_jobs SET public_id=public_id WHERE false','SELECT * FROM product_media'])await denied(pools.media_cleanup,sql);
  for(const sql of ['UPDATE products SET name=name WHERE false','DELETE FROM audit_events WHERE false','INSERT INTO carts DEFAULT VALUES'])await denied(pools.backup,sql);
});
test('restricted identities support auth, catalogue, cart, checkout, mocked payments and fulfillment while enforcing human permissions',{timeout:60000},async()=>{
  const previous=process.env.DATABASE_URL;process.env.DATABASE_URL=urls.catalogue;
  try{assert.ok((await getPublishedProducts()).items.length>0);}finally{await closeDatabase();if(previous===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=previous;}
  const owner=await headers(),manager=await headers('CATALOGUE_MANAGER');
  assert.ok(await saveProduct(owner,null,{product:product('Runtime role fixture'),action:'save'},runtime));
  const f={...base,runtime,cartUrl:urls.cart,paymentUrl:urls.payment,readerUrl:urls.catalogue};
  const order=await fixtureOrder(f);assert.equal((await order.customer()).status,200);
  const endpoint=base.authConfig.baseURL+'/api/admin/orders/'+order.id;
  const request=(h:Headers)=>new Request(endpoint,{headers:h});
  assert.equal((await ordersHttp(request(new Headers()),[order.id],runtime)).status,401);
  assert.equal((await ordersHttp(request(manager),[order.id],runtime)).status,403);
  const detail=await ordersHttp(request(owner),[order.id],runtime);assert.equal(detail.status,200);const view=(await detail.json()).order;
  const h=new Headers(owner);h.set('Origin',base.authConfig.baseURL);h.set('Content-Type','application/json');
  assert.equal((await ordersHttp(new Request(endpoint,{method:'POST',headers:h,body:JSON.stringify({action:'prepare',revision:view.revision,operationId:randomUUID()})}),[order.id],runtime)).status,200);
});
test('media LOGIN cleans synthetic jobs with audit; backup LOGIN makes an encrypted PostgreSQL18 archive',{timeout:60000},async()=>{
  const id=randomUUID(),publicId='la-palme/catalogue/'+developmentId(102)+'/'+randomUUID();
  await base.data.query("INSERT INTO catalogue_media_jobs(id,product_id,public_id,state,available_at) VALUES($1,$2,$3,'DELETE_PENDING',now()-INTERVAL '1 minute')",[id,developmentId(102),publicId]);
  const destroyed:string[]=[],provider={destroy:async(id:string)=>{destroyed.push(id);}} as unknown as MediaProvider;
  assert.equal((await systemMediaCleanup(pools.media_cleanup,provider,1)).completed,1);assert.deepEqual(destroyed,[publicId]);
  assert.equal((await base.data.query("SELECT count(*)::int n FROM audit_events WHERE action='CATALOGUE_MEDIA_CLEANED'")).rows[0].n,1);
  const output=join(root,'role-backup.lpdg'),result=await backupDatabase(urls.backup,output,randomBytes(32).toString('base64url'),bin);
  assert.ok(result.bytes>0);assert.equal((await readFile(output)).subarray(0,6).toString(),'LPDG1\0');
});

