import assert from 'node:assert/strict';
import {before,after,test} from 'node:test';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import pg from 'pg';
import {catalogueFixture} from './helpers/catalogue-fixture.mts';
import {sessionCookie} from './helpers/admin-fixture.mts';
import {customerStagingReviews} from '../scripts/prepare-customer-staging.mts';
import {databaseConfig} from '../src/lib/db/config.ts';
import {createCustomerRuntime} from '../src/lib/customer/runtime.ts';
import {customerAuthHttp} from '../src/lib/customer/http.ts';
import {customerAccountHttp} from '../src/lib/customer/account.ts';
import {submitRequest} from '../src/lib/requests/repository.ts';
import {getCurrentAdmin} from '../src/lib/admin/authorization.ts';

let f:Awaited<ReturnType<typeof catalogueFixture>>,root:string,reviews:Awaited<ReturnType<typeof customerStagingReviews>>,customer:pg.Pool,runtime:ReturnType<typeof createCustomerRuntime>;
const role='lapalme_staging_customer',backup='lapalme_staging_backup',password=randomBytes(32).toString('base64url');
let beforeRows:Map<string,string>,oldLedger:unknown[],customerCreated=false,backupCreated=false;
const core=['customer_auth_users','customer_auth_sessions','customer_auth_accounts','customer_auth_verifications','customer_auth_rate_limits'];
async function snapshot(){const result=new Map<string,string>();for(const {tablename} of (await f.data.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'schema_migrations' AND tablename NOT LIKE 'customer_auth_%' ORDER BY tablename")).rows){result.set(tablename,JSON.stringify((await f.data.query(`SELECT to_jsonb(t) row FROM public.${tablename} t ORDER BY to_jsonb(t)::text`)).rows));}return result;}
function apply(kind:keyof typeof reviews,local=true,host='127.0.0.1',overrides:Record<string,string>={}){
 const config=databaseConfig(f.ownerUrl),env={...Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^PG|^CUSTOMER_STAGING_/i.test(k))),NODE_ENV:process.env.NODE_ENV,PGHOST:host,PGPORT:String(config.port),PGDATABASE:config.database,PGUSER:'postgres',PGSSLMODE:'disable',CUSTOMER_STAGING_DATABASE_PASSWORD:password,...overrides};
 return spawnSync(join(process.env.PG_BIN??'C:/Program Files/PostgreSQL/17/bin','psql'),['-X','--no-password','--set=ON_ERROR_STOP=1','--set=local_rehearsal='+local,'--file='+join(root,kind+'.sql')],{env,encoding:'utf8',windowsHide:true,timeout:30000}).status;
}
before(async()=>{
 f=await catalogueFixture(undefined,true,13);assert.equal((await f.data.query('SHOW server_version_num')).rows[0].server_version_num,'180006');
 for(const name of [role,backup])assert.equal((await f.data.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[name])).rowCount,0,'Never reuse an existing role.');
 root=await mkdtemp(join(tmpdir(),'lapalme-customer-preparation-'));reviews=await customerStagingReviews();for(const [name,sql]of Object.entries(reviews))await writeFile(join(root,name+'.sql'),sql);
 const category=randomUUID();await f.data.query("INSERT INTO categories(id,slug,name,is_visible) VALUES($1,'local-staging-rings','LOCAL TEST ONLY Staging Rings',true)",[category]);
 for(let i=0;i<5;i++){const id=randomUUID();await f.data.query("INSERT INTO products(id,slug,name,description,product_type,sales_mode,status,published_at) VALUES($1,$2,$3,'LOCAL TEST ONLY staging preservation fixture.','REPEATABLE','ENQUIRY_ONLY','PUBLISHED','2020-01-01T00:00:00Z')",[id,'local-staging-ring-'+id,'LOCAL TEST ONLY Ring '+i]);await f.data.query('INSERT INTO product_categories(product_id,category_id) VALUES($1,$2)',[id,category]);await f.data.query("INSERT INTO product_media(product_id,external_media_reference,media_type,alt_text,is_primary) VALUES($1,'/images/ring-emerald.png','IMAGE','LOCAL TEST ONLY photo',true)",[id]);}
 for(const table of ['product_enquiries','bespoke_requests','appointment_requests'])await f.data.query(`INSERT INTO ${table}(contact_name,contact_email,message) VALUES('LOCAL Historical Guest','guest@boutique.test','LOCAL TEST ONLY historical guest retained.');`);
 await f.data.query(`CREATE ROLE ${backup} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`);backupCreated=true;
 await f.data.query(`GRANT USAGE ON SCHEMA public TO ${backup}; GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${backup}`);
 beforeRows=await snapshot();oldLedger=(await f.data.query('SELECT * FROM schema_migrations ORDER BY version')).rows;
},{timeout:60000});
after(async()=>{await runtime?.pool.end();await customer?.end();if(f){for(const [name,created]of [[role,customerCreated],[backup,backupCreated]]as const)if(created){await f.data.query('DROP OWNED BY '+name);await f.data.query('DROP ROLE '+name);}await f.close();}if(root){assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep)&&root.includes('lapalme-customer-preparation-'));await rm(root,{recursive:true,force:true});}});

test('offline review artifacts exactly derive from the approved 0014 migration and permission contract',async()=>{
 for(const [kind,sql]of Object.entries(reviews)){const file={migration:'migration',role:'role',backup:'backup'}[kind]!;assert.equal(await readFile('infra/neon/staging-customer-'+file+'.review.sql','utf8'),sql);}
 const original=await readFile('db/migrations/0014_customer_authentication.sql','utf8');assert.ok(reviews.migration.includes(original.replace(/^BEGIN;\r?\n/,'').replace(/\r?\nCOMMIT;\s*$/,'')));
 assert.ok(reviews.migration.includes("checksum_sha256='52d69366fdcebafb552611c0c146a12f859798d8b7940db37926286b7d984c07'"));
});
test('wrong endpoint, missing approval, changed checksum and lock contention refuse migration without writes',async()=>{
 assert.notEqual(apply('migration',false),0);assert.notEqual(apply('migration',true,'localhost'),0);
 assert.notEqual(apply('migration',true,'127.0.0.1',{PGHOSTADDR:'127.0.0.1'}),0,'Routing overrides must be refused even when they resolve locally.');
 const checksum=(await f.data.query("SELECT checksum_sha256 FROM schema_migrations WHERE version='0013'")).rows[0].checksum_sha256;
 await f.data.query("UPDATE schema_migrations SET checksum_sha256=repeat('0',64) WHERE version='0013'");try{assert.notEqual(apply('migration'),0);}finally{await f.data.query("UPDATE schema_migrations SET checksum_sha256=$1 WHERE version='0013'",[checksum]);}
 const lock=await f.data.connect();await lock.query('SELECT pg_advisory_lock(1279348813,2)');try{assert.notEqual(apply('migration'),0);}finally{await lock.query('SELECT pg_advisory_unlock(1279348813,2)');lock.release();}
 assert.equal((await f.data.query("SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'customer_auth_%'")).rows[0].count,'0');assert.equal((await f.data.query('SELECT count(*) FROM schema_migrations')).rows[0].count,'13');
});
test('exact 0013 to 0014 rehearsal preserves every existing business row, guest request and migration checksum',async()=>{
 assert.equal(apply('migration'),0,'Incremental operator review must apply locally.');assert.deepEqual((await f.data.query("SELECT * FROM schema_migrations WHERE version<='0013' ORDER BY version")).rows,oldLedger);
 const afterRows=await snapshot();assert.equal(afterRows.size,beforeRows.size);for(const [table,rows]of beforeRows)assert.ok(afterRows.get(table)===rows,table+' business data must remain byte-equivalent.');
 assert.equal((await f.data.query("SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'customer_auth_%'")).rows[0].count,'5');assert.notEqual(apply('migration'),0,'Replay must refuse an already migrated database.');
 for(const table of ['product_enquiries','bespoke_requests','appointment_requests'])assert.equal((await f.data.query(`SELECT customer_profile_id FROM ${table} WHERE contact_email='guest@boutique.test'`)).rows[0].customer_profile_id,null);
});
test('customer core uniqueness and session foreign keys remain separate from administrator identities',async()=>{
 const id=randomUUID(),email='constraint-'+randomUUID()+'@boutique.test';await f.data.query('INSERT INTO customer_auth_users(id,name,email) VALUES($1,$2,$3)',[id,'Local Constraint Customer',email]);
 await assert.rejects(f.data.query('INSERT INTO customer_auth_users(name,email) VALUES($1,$2)',['Local Duplicate',email]),{code:'23505'});
 await f.data.query('INSERT INTO customer_auth_sessions(user_id,token,expires_at) VALUES($1,$2,now()+interval \'1 day\')',[id,randomBytes(32).toString('base64url')]);
 await f.data.query('DELETE FROM customer_auth_users WHERE id=$1',[id]);assert.equal((await f.data.query('SELECT count(*) FROM customer_auth_sessions WHERE user_id=$1',[id])).rows[0].count,'0');
 await assert.rejects(f.data.query('INSERT INTO customer_auth_sessions(user_id,token,expires_at) VALUES($1,$2,now())',[f.users.OWNER.id,randomBytes(32).toString('base64url')]),{code:'23503'});
});
test('customer role grants match the complete independent table and column permission matrix',async()=>{
 assert.equal(apply('role'),0);customerCreated=true;assert.notEqual(apply('role'),0,'Existing credentials/role must not be overwritten.');
 const url=new URL(f.ownerUrl);url.username=role;url.password=password;customer=new pg.Pool(databaseConfig(url.toString()));
 const allowed=new Map<string,Set<string>>(),columns=new Map<string,Set<string>>();
 const table=(names:string[],privileges:string[])=>{for(const name of names)allowed.set(name,new Set([...(allowed.get(name)??[]),...privileges]));};
 const column=(name:string,privilege:string,fields:string)=>columns.set(name+':'+privilege,new Set(fields.split(',')));
 table([...core,'cart_rate_limits'],['SELECT','INSERT','UPDATE','DELETE']);table(['customer_profiles','products','product_variants','product_gemstones','gemstones','boutique_locations'],['SELECT']);table(['audit_events'],['INSERT']);
 column('customer_profiles','INSERT','auth_provider,auth_subject,full_name,email');column('customer_profiles','UPDATE','full_name,phone,updated_at');for(const name of ['products','product_variants'])column(name,'UPDATE','updated_at');
 const visible='id,customer_profile_id,product_id,variant_id,contact_name,contact_email,contact_phone,message,status,product_context,created_at',insert='id,customer_profile_id,product_id,variant_id,contact_name,contact_email,contact_phone,message,product_context';
 for(const name of ['product_enquiries','bespoke_requests','appointment_requests']){column(name,'SELECT',visible+(name==='appointment_requests'?',consultation_channel,preferred_start_at,confirmed_start_at,boutique_location_id':''));column(name,'INSERT',insert+(name==='appointment_requests'?',consultation_channel,preferred_start_at':''));}
 const tables=(await customer.query("SELECT c.relname t,p,has_table_privilege(current_user,c.oid,p) allowed,has_table_privilege(current_user,c.oid,p||' WITH GRANT OPTION') grantable FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p WHERE n.nspname='public' AND c.relkind='r'")).rows;
 assert.equal(tables.length,43*8);for(const r of tables){assert.equal(r.allowed,allowed.get(r.t)?.has(r.p)??false,r.t+':'+r.p);assert.equal(r.grantable,false);}
 const fields=(await customer.query("SELECT c.relname t,a.attname col,p,has_column_privilege(current_user,c.oid,a.attnum,p) allowed FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) p WHERE n.nspname='public' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped")).rows;
 for(const r of fields)assert.equal(r.allowed,!!(allowed.get(r.t)?.has(r.p)||columns.get(r.t+':'+r.p)?.has(r.col)),r.t+':'+r.col+':'+r.p);
 for(const sql of ['SELECT * FROM admin_users','SELECT * FROM orders','UPDATE payments SET status=status WHERE false','UPDATE inventory SET updated_at=updated_at WHERE false','UPDATE product_enquiries SET status=status WHERE false','DELETE FROM appointment_requests WHERE false','CREATE TABLE public.forbidden_customer(id int)','SET ROLE postgres'])await assert.rejects(customer.query(sql),{code:'42501'});
});
test('prepared restricted identity supports OTP and owned requests without authorizing administrators or another customer',async()=>{
 const url=new URL(f.ownerUrl);url.username=role;url.password=password;const mails:{email:string;otp:string}[]=[];runtime=createCustomerRuntime({databaseUrl:url.toString(),baseURL:f.authConfig.baseURL,secret:randomBytes(32).toString('base64url')},async message=>{mails.push(message);});
 async function signIn(){const email=randomUUID()+'@boutique.test';const request=(path:string,body:unknown)=>new Request(f.authConfig.baseURL+'/api/customer-auth/'+path,{method:'POST',headers:{Origin:f.authConfig.baseURL,'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal((await customerAuthHttp(request('send-code',{email}),runtime)).status,200);const response=await customerAuthHttp(request('verify-code',{email,code:mails.at(-1)!.otp,name:'Local Prepared Customer'}),runtime);assert.equal(response.status,200);return new Headers({Cookie:sessionCookie(response)});}
 const owner=await signIn(),other=await signIn(),input={submissionId:randomUUID(),kind:'BESPOKE',name:'Local Prepared Request',message:'LOCAL TEST ONLY prepared customer role request.'};
 assert.equal((await submitRequest(input,runtime,owner)).reference,input.submissionId);await assert.rejects(submitRequest(input,runtime,other),{status:409});assert.equal(await getCurrentAdmin(owner,f.runtime),null);
 const path=['requests',input.submissionId];assert.equal((await customerAccountHttp(new Request(f.authConfig.baseURL+'/api/account/'+path.join('/'),{headers:other}),path,runtime)).status,404);
});
test('backup grant adds only SELECT on the five new auth tables and retains write/schema denial',async()=>{
 for(const table of core)assert.equal((await f.data.query('SELECT has_table_privilege($1,$2,\'SELECT\') allowed',[backup,table])).rows[0].allowed,false);
 assert.equal(apply('backup'),0);const url=new URL(f.ownerUrl);url.username=backup;url.password='';const pool=new pg.Pool(databaseConfig(url.toString()));
 try{for(const table of core){assert.equal((await pool.query('SELECT current_user')).rows[0].current_user,backup);await pool.query('SELECT * FROM '+table+' LIMIT 0');for(const privilege of ['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'])assert.equal((await pool.query('SELECT has_table_privilege(current_user,$1,$2) allowed',[table,privilege])).rows[0].allowed,false);}await assert.rejects(pool.query('CREATE TABLE public.backup_forbidden(id int)'),{code:'42501'});}finally{await pool.end();}
});
