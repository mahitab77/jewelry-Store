// Exercise retained direct-sales behavior; quotation-only denial has its own suites.
process.env.COMMERCE_MODE = "DIRECT_SALES";
import assert from 'node:assert/strict';
import { after,before,test } from 'node:test';
import { randomBytes,randomUUID } from 'node:crypto';
import { mkdtemp,readFile,readdir,rm,writeFile } from 'node:fs/promises';
import { join,resolve,sep } from 'node:path';
import { tmpdir } from 'node:os';
import pg from 'pg';
import { orderFixture,fixtureOrder } from './helpers/order-fixture.mts';
import { backupDatabase,restoreLocalBackup,BackupError } from '../db/tools/backup.ts';
import { runMigrations } from '../db/tools/migrate.ts';
import { databaseConfig } from '../src/lib/db/config.ts';
import { closeDatabase } from '../src/lib/db/client.ts';
import { publicSitemap } from '../src/lib/catalogue/sitemap.ts';
import { siteOrigin,siteIndexingAllowed } from '../src/lib/site.ts';
import robots from '../src/app/robots.ts';
import config from '../next.config.ts';
import { systemMediaCleanup } from '../src/lib/media/cleanup.ts';
import type { MediaProvider } from '../src/lib/media/cloudinary.ts';
import { developmentId } from '../db/tools/seed.ts';

let f:Awaited<ReturnType<typeof orderFixture>>,root:string,maintenance:pg.Pool;
let mediaPool:pg.Pool,mediaRole:string;
const bin=process.env.PG_BIN??(process.platform==='win32'?'C:\\Program Files\\PostgreSQL\\17\\bin':'/usr/bin');
const secret=randomBytes(32).toString('base64url'),owned=new Set<string>();
const envNames=['SITE_URL','SITE_INDEXING_ALLOWED','DATABASE_URL','PGHOSTADDR','PGSERVICE','PGDATABASE'];
const old=new Map(envNames.map(k=>[k,process.env[k]]));let archive:string;
before(async()=>{f=await orderFixture();maintenance=new pg.Pool(databaseConfig(process.env.TEST_DATABASE_URL));root=await mkdtemp(join(tmpdir(),'la-palme-readiness-'));archive=join(root,'fixture.lpdg');await fixtureOrder(f);
  mediaRole='lapalme_media_job_'+randomUUID().replaceAll('-','');await f.data.query(`CREATE ROLE "${mediaRole}" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`);
  await f.data.query(`GRANT USAGE ON SCHEMA public TO "${mediaRole}"`);await f.data.query(`GRANT SELECT ON catalogue_media_jobs TO "${mediaRole}"`);await f.data.query(`GRANT UPDATE(state,attempts,available_at,updated_at) ON catalogue_media_jobs TO "${mediaRole}"`);await f.data.query(`GRANT SELECT(id,cloudinary_public_id) ON product_media TO "${mediaRole}"`);await f.data.query(`GRANT INSERT ON audit_events TO "${mediaRole}"`);
  const url=new URL(f.ownerUrl);url.username=mediaRole;url.password='';mediaPool=new pg.Pool(databaseConfig(url.toString()));
},{timeout:60000});
after(async()=>{await closeDatabase();await mediaPool?.end();if(mediaRole){await f.data.query(`DROP OWNED BY "${mediaRole}"`);await f.data.query(`DROP ROLE "${mediaRole}"`);}for(const name of owned)await maintenance.query(`DROP DATABASE IF EXISTS "${name}"`);await maintenance?.end();await f?.close();for(const[k,v]of old){if(v===undefined)delete process.env[k];else process.env[k]=v;}if(root){assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep)&&root.includes('la-palme-readiness-'));await rm(root,{recursive:true,force:true});}});
async function target(create=false){const name='lapalme_test_restore_'+randomUUID().replaceAll('-','');if(create)await maintenance.query(`CREATE DATABASE "${name}"`);owned.add(name);const url=new URL(process.env.TEST_DATABASE_URL!);url.pathname='/'+name;return url.toString();}

test('canonical origin rejects placeholders, insecure URLs, credentials and paths',()=>{for(const value of [undefined,'http://boutique.test','https://user:secret@boutique.test','https://boutique.test/path','https://YOUR_CONFIRMED_HOST','https://example.invalid','https://boutique.test?token=x'])assert.equal(siteOrigin(value),null);assert.equal(siteOrigin('https://boutique.test/'),'https://boutique.test');});
test('staging/missing configuration is nonindexable without database access',async()=>{delete process.env.SITE_URL;process.env.SITE_INDEXING_ALLOWED='false';delete process.env.DATABASE_URL;assert.equal(siteIndexingAllowed(),false);assert.deepEqual(robots(),{rules:{userAgent:'*',disallow:'/'}});assert.deepEqual(await publicSitemap(),[]);});
test('security response headers and safe default indexing are configured',async()=>{const sets=await config.headers!();assert.ok(sets.some(s=>s.headers.some(h=>h.key==='X-Frame-Options'&&h.value==='DENY')));for(const name of ['X-Content-Type-Options','Referrer-Policy','Permissions-Policy','X-Robots-Tag'])assert.ok(sets.some(s=>s.headers.some(h=>h.key===name)));});
test('public sitemap uses restricted reads and excludes fixtures, hidden ancestry and unpublished records',async()=>{
  process.env.SITE_URL='https://boutique.test';process.env.SITE_INDEXING_ALLOWED='true';process.env.DATABASE_URL=f.readerUrl;
  await f.data.query(`INSERT INTO products(name,slug,product_type,sales_mode,status,published_at) VALUES
    ('Readiness public jewel','readiness-public-jewel','REPEATABLE','ENQUIRY_ONLY','PUBLISHED',now()),
    ('Readiness private jewel','readiness-private-jewel','REPEATABLE','ENQUIRY_ONLY','DRAFT',NULL),
    ('Readiness future jewel','readiness-future-jewel','REPEATABLE','ENQUIRY_ONLY','PUBLISHED',now()+INTERVAL '1 day')`);
  const parent=(await f.data.query("INSERT INTO categories(name,slug,is_visible) VALUES('Hidden readiness category','readiness-hidden',false) RETURNING id")).rows[0].id;
  await f.data.query("INSERT INTO categories(name,slug,is_visible,parent_id) VALUES('Readiness child','readiness-child',true,$1)",[parent]);
  const entries=await publicSitemap(),urls=entries.map(e=>e.url);assert.ok(urls.includes('https://boutique.test/jewels/readiness-public-jewel'));assert.ok(!urls.some(u=>/dev-|readiness-child|readiness-private|readiness-future|admin|orders|checkout|cart/.test(u)));
  assert.deepEqual(robots().sitemap,'https://boutique.test/sitemap.xml');await closeDatabase();
});
test('runtime roles lack superuser, inheritance, cross-role membership and persistent DDL privileges',async()=>{
  const roles=[f.role,f.readerRole,f.cartRole,f.paymentRole,mediaRole];
  for(const role of roles){const row=(await f.data.query('SELECT rolsuper,rolcreaterole,rolcreatedb,rolinherit FROM pg_roles WHERE rolname=$1',[role])).rows[0];assert.deepEqual(row,{rolsuper:false,rolcreaterole:false,rolcreatedb:false,rolinherit:false});assert.equal((await f.data.query("SELECT has_schema_privilege($1,'public','CREATE') AS allowed",[role])).rows[0].allowed,false);
    assert.equal((await f.data.query('SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname=$1',[role])).rows[0].count,'0');}
  assert.equal((await f.data.query("SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef")).rows[0].count,'0');
});
test('public/cart/admin roles cannot read secrets or mutate financial snapshots outside their purpose',async()=>{
  for(const[role,table,column,privilege]of [[f.readerRole,'orders','customer_email','SELECT'],[f.cartRole,'orders','customer_name','SELECT'],[f.role,'payments','checkout_client_secret','SELECT'],[f.role,'payments','status','UPDATE'],[f.role,'orders','payment_status','UPDATE'],[f.paymentRole,'order_items','unit_price_minor','UPDATE'],[f.paymentRole,'order_addresses','street_address','UPDATE']])assert.equal((await f.data.query('SELECT has_column_privilege($1,$2,$3,$4) AS allowed',[role,table,column,privilege])).rows[0].allowed,false);
});
test('backup produces authenticated ciphertext and scrubs inherited libpq destination overrides',async()=>{
  process.env.PGHOSTADDR='127.0.0.2';process.env.PGSERVICE='nonexistent-readiness-service';process.env.PGDATABASE='wrong-readiness-target';
  const result=await backupDatabase(f.ownerUrl,archive,secret,bin);assert.ok(result.bytes>1000);const bytes=await readFile(archive);assert.equal(bytes.subarray(0,6).toString(),'LPDG1\0');assert.ok(!bytes.includes(Buffer.from('Checkout Fixture')));assert.ok(!bytes.includes(Buffer.from(f.authConfig.secret)));
});
test('encrypted backup restores to an empty isolated database with all migration checksums and paid order history',async()=>{
  const url=await target();await restoreLocalBackup(url,archive,secret,bin);const restored=new pg.Pool(databaseConfig(url));
  try{const rows=(await restored.query('SELECT version,filename,checksum_sha256 FROM schema_migrations ORDER BY version')).rows;assert.equal(rows.length,13);assert.deepEqual(rows,(await f.data.query('SELECT version,filename,checksum_sha256 FROM schema_migrations ORDER BY version')).rows);assert.deepEqual(await runMigrations(url),[]);
    assert.deepEqual((await restored.query('SELECT id,payment_status,total_minor,fulfillment_status FROM orders ORDER BY id')).rows,(await f.data.query('SELECT id,payment_status,total_minor,fulfillment_status FROM orders ORDER BY id')).rows);
    assert.equal((await restored.query('SELECT count(*) FROM payment_events')).rows[0].count,(await f.data.query('SELECT count(*) FROM payment_events')).rows[0].count);
    await assert.rejects(restoreLocalBackup(url,archive,secret,bin),BackupError);
  }finally{await restored.end();}
});
test('tampered ciphertext fails authentication before any restore-target change',async()=>{const corrupted=join(root,'tampered.lpdg'),bytes=Buffer.from(await readFile(archive));bytes[bytes.length-1]^=1;await writeFile(corrupted,bytes,{mode:0o600});const url=await target();await assert.rejects(restoreLocalBackup(url,corrupted,secret,bin),BackupError);assert.equal((await maintenance.query('SELECT count(*) FROM pg_database WHERE datname=$1',[new URL(url).pathname.slice(1)])).rows[0].count,'0');});
test('restore refuses existing empty, routine-only, enum-only and custom-schema databases',async()=>{for(const sql of ['',"CREATE FUNCTION public.readiness_function() RETURNS int LANGUAGE sql AS 'SELECT 1'","CREATE TYPE public.readiness_enum AS ENUM ('fixture')","CREATE SCHEMA pgcustom; CREATE TABLE pgcustom.fixture(id int)"]){const url=await target(true),client=new pg.Pool(databaseConfig(url));try{if(sql)await client.query(sql);await assert.rejects(restoreLocalBackup(url,archive,secret,bin),BackupError);}finally{await client.end();}}});
test('wrong keys fail and private plaintext staging is removed',async()=>{const before=(await readdir(tmpdir())).filter(n=>n.startsWith('la-palme-restore-')).sort();await assert.rejects(restoreLocalBackup(await target(),archive,randomBytes(32).toString('base64url'),bin),BackupError);assert.deepEqual((await readdir(tmpdir())).filter(n=>n.startsWith('la-palme-restore-')).sort(),before);});
test('restore refuses hosted destinations and non-disposable database names before connection',async()=>{for(const url of ['postgresql://fixture:unused@remote.invalid/lapalme_test_restore_fixture?sslmode=verify-full',f.ownerUrl])await assert.rejects(restoreLocalBackup(url,archive,secret,bin),BackupError);});
test('backup refuses repository output, invalid keys and overwriting existing archives',async()=>{await assert.rejects(backupDatabase(f.ownerUrl,resolve('forbidden-backup.lpdg'),secret,bin),BackupError);await assert.rejects(backupDatabase(f.ownerUrl,join(root,'bad-key.lpdg'),'placeholder',bin),BackupError);const original=await readFile(archive);await assert.rejects(backupDatabase(f.ownerUrl,archive,secret,bin),BackupError);assert.deepEqual(await readFile(archive),original);});

async function mediaJob(){const id=randomUUID(),publicId='la-palme/catalogue/'+developmentId(102)+'/'+randomUUID();await f.data.query("INSERT INTO catalogue_media_jobs(id,product_id,public_id,state,available_at) VALUES($1,$2,$3,'DELETE_PENDING',now()-INTERVAL '1 minute')",[id,developmentId(102),publicId]);return{id,publicId};}
function provider(destroy:(id:string)=>Promise<void>):MediaProvider{return {destroy,async upload(){throw new Error('Unexpected upload');},async read(){throw new Error('Unexpected read');}};}
test('operator media cleanup runs without browser sessions, is bounded and idempotent',async()=>{const job=await mediaJob();let calls=0;const p=provider(async id=>{assert.equal(id,job.publicId);calls++;});assert.deepEqual(await systemMediaCleanup(mediaPool,p,1),{completed:1,pending:0});assert.deepEqual(await systemMediaCleanup(mediaPool,p,1),{completed:0,pending:0});assert.equal(calls,1);const audit=(await f.data.query("SELECT actor_kind,actor_admin_id FROM audit_events WHERE action='CATALOGUE_MEDIA_CLEANED' AND metadata->>'jobId'=$1",[job.id])).rows;assert.deepEqual(audit,[{actor_kind:'SYSTEM',actor_admin_id:null}]);});
test('concurrent media cleanup claims one deletion and audit, with provider calls outside row locks',async()=>{const job=await mediaJob();let calls=0;const p=provider(async()=>{calls++;const c=await f.data.connect();try{await c.query('BEGIN');await c.query('SELECT id FROM catalogue_media_jobs WHERE id=$1 FOR UPDATE NOWAIT',[job.id]);await c.query('ROLLBACK');}finally{c.release();}});const results=await Promise.all([systemMediaCleanup(mediaPool,p,1),systemMediaCleanup(mediaPool,p,1)]);assert.equal(results.reduce((sum,r)=>sum+r.completed,0),1);assert.equal(calls,1);assert.equal((await f.data.query("SELECT count(*) FROM audit_events WHERE action='CATALOGUE_MEDIA_CLEANED' AND metadata->>'jobId'=$1",[job.id])).rows[0].count,'1');});
test('failed media deletion retains a durable lease and succeeds on a later safe retry',async()=>{const job=await mediaJob();assert.equal((await systemMediaCleanup(mediaPool,provider(async()=>{throw new Error('Synthetic provider interruption');}),1)).pending,1);let calls=0;const p=provider(async()=>{calls++;});await systemMediaCleanup(mediaPool,p,1);assert.equal(calls,0);await f.data.query("UPDATE catalogue_media_jobs SET available_at=now()-INTERVAL '1 second' WHERE id=$1",[job.id]);assert.equal((await systemMediaCleanup(mediaPool,p,1)).completed,1);assert.equal(calls,1);await assert.rejects(systemMediaCleanup(mediaPool,p,51));});
