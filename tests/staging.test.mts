import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { stagingManifest, stagingMigrationReview } from '../scripts/prepare-staging.mts';
import { databaseConfig, isLoopback } from '../src/lib/db/config.ts';

const input = { projectId:'lapalme-fixture', projectNumber:'123456789012', region:'europe-west1', service:'lapalme-staging', runtimeServiceAccount:'lapalme-staging-runtime@lapalme-fixture.iam.gserviceaccount.com', image:'europe-west1-docker.pkg.dev/lapalme-fixture/lapalme-staging/web@sha256:'+'a'.repeat(64), origin:'', secrets:{} };
const refs = Object.fromEntries(['DATABASE_URL','ADMIN_DATABASE_URL','CART_DATABASE_URL','BETTER_AUTH_SECRET'].map(name=>[name,{name:'lapalme-staging-'+name.toLowerCase().replaceAll('_','-'),version:'1'}]));
test('bootstrap remains IAM-restricted, unconfigured and payment/retention gates stay off',async()=>{
 const m=await stagingManifest(input),s=m.spec.template.spec,e=Object.fromEntries(s.containers[0].env.map((v:{name:string;value:string})=>[v.name,v.value]));
 assert.equal(m.metadata.namespace,input.projectNumber);assert.equal(m.metadata.labels['cloud.googleapis.com/location'],input.region);
 assert.equal(m.metadata.annotations['run.googleapis.com/invoker-iam-disabled'],'false');assert.equal(m.metadata.annotations['run.googleapis.com/minScale'],'0');assert.equal(m.metadata.annotations['run.googleapis.com/maxScale'],'2');assert.equal(s.containerConcurrency,4);assert.equal(s.containers[0].resources.limits.memory,'1Gi');
 for(const name of ['SITE_INDEXING_ALLOWED','CHECKOUT_DRAFT_RETENTION_READY','PAYMENTS_TEST_ENABLED','PAYMENTS_RECONCILIATION_READY'])assert.equal(e[name],'false');assert.equal(e.SITE_URL,'');assert.equal(e.ADMIN_TRUSTED_IP_HEADER,'');
});
test('configured artifact contains pinned secret references, with no raw secret values',async()=>{
 const m=await stagingManifest({...input,origin:'https://lapalme-staging-fixture.a.run.app',secrets:refs});
 const env=m.spec.template.spec.containers[0].env;
 for(const name of Object.keys(refs)){const item=env.find((v:{name:string})=>v.name===name);assert.equal(item.value,undefined);assert.equal(item.valueFrom.secretKeyRef.key,'1');}
 assert.equal(env.find((v:{name:string})=>v.name==='CART_ORIGIN').value,'https://lapalme-staging-fixture.a.run.app');
});
test('preparation rejects live gates, raw credentials, foreign images, unpinned secrets and insecure origins',async()=>{
 for(const patch of [{PAYMENTS_TEST_ENABLED:'true'},{secrets:{DATABASE_URL:'postgresql://private.invalid/value'}},{image:input.image.replace('@sha256:'+'a'.repeat(64),':latest')},{runtimeServiceAccount:'123-compute@developer.gserviceaccount.com'},{origin:'http://lapalme-staging-fixture.a.run.app',secrets:refs},{origin:'https://lapalme-staging-fixture.a.run.app/path',secrets:refs},{origin:'https://boutique.example.com',secrets:refs},{origin:'https://lapalme-staging-fixture.a.run.app',secrets:{...refs,BETTER_AUTH_SECRET:{name:'production-auth',version:'latest'}}}])await assert.rejects(stagingManifest({...input,...patch}));
});
test('offline CLI refuses overwrite/repository destinations and makes no partial artifact for invalid inputs',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'lapalme-staging-cli-'));try{const config=join(dir,'input.json'),out=join(dir,'service.json');await writeFile(config,JSON.stringify(input));
 const run=(target:string)=>spawnSync(process.execPath,['--experimental-strip-types','scripts/prepare-staging.mts','service',config,target],{encoding:'utf8',windowsHide:true});
 assert.equal(run(out).status,0);const before=await readFile(out);assert.equal(run(out).status,1);assert.deepEqual(await readFile(out),before);assert.equal(run(join(process.cwd(),'forbidden-staging.json')).status,1);
 await writeFile(config,JSON.stringify({...input,image:'invalid'}));assert.equal(run(join(dir,'invalid.json')).status,1);await assert.rejects(readFile(join(dir,'invalid.json')));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('fresh review SQL applies all 12 exact migrations and refuses replay/wrong targets',async()=>{
 const config=databaseConfig(process.env.TEST_DATABASE_URL);assert.ok(process.env.TEST_DATABASE_URL&&isLoopback(config.host??'')&&process.env.NODE_ENV!=='production');
 const maintenance=new pg.Pool(config),name='lapalme_test_staging_'+randomUUID().replaceAll('-',''),dir=await mkdtemp(join(tmpdir(),'lapalme-staging-sql-'));let db:pg.Pool|undefined,created=false;
 try{await maintenance.query(`CREATE DATABASE "${name}"`);created=true;const url=new URL(process.env.TEST_DATABASE_URL!);url.pathname='/'+name;db=new pg.Pool(databaseConfig(url.toString()));const script=join(dir,'review.sql'),review=await stagingMigrationReview();await writeFile(script,review);
 const bin=process.env.PG_BIN??(process.platform==='win32'?'C:/Program Files/PostgreSQL/17/bin':'/usr/bin');
 const env={...Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^PG/i.test(k))),NODE_ENV:process.env.NODE_ENV,PGHOST:config.host,PGPORT:String(config.port),PGUSER:config.user,PGPASSWORD:config.password as string,PGDATABASE:name,PGSSLMODE:'disable'};
 const run=(expected:string,expectedUser=config.user)=>spawnSync(join(bin,process.platform==='win32'?'psql.exe':'psql'),['-X','--no-password','-v','ON_ERROR_STOP=1','-v','expected_database='+expected,'-v','expected_user='+expectedUser,'-f',script],{env,windowsHide:true,encoding:'utf8'});
 assert.notEqual(run('wrong_staging_target').status,0);assert.equal((await db.query('SELECT count(*) FROM pg_tables WHERE schemaname=\'public\'')).rows[0].count,'0');
 assert.notEqual(run(name,'wrong_staging_user').status,0);
 // Exercise the emitted gate with unsupported version fixtures; the unmodified
 // artifact below must still verify the actual server's version and identity.
 const setting="current_setting('server_version_num')::int";assert.ok(review.includes(setting));
 for(const unsupported of [160000,190000]){
   await writeFile(script,review.replace(setting,String(unsupported)));
   assert.notEqual(run(name).status,0);
   assert.equal((await db.query('SELECT count(*) FROM pg_tables WHERE schemaname=\'public\'')).rows[0].count,'0');
 }
 await writeFile(script,review);
 const lock=await db.connect();try{await lock.query('SELECT pg_advisory_lock(1279348813,2)');assert.notEqual(run(name).status,0);}
 finally{await lock.query('SELECT pg_advisory_unlock(1279348813,2)');lock.release();}
 await db.query('CREATE TABLE public.staging_drift_fixture(id integer)');
 assert.notEqual(run(name).status,0);assert.equal((await db.query('SELECT count(*) FROM pg_tables WHERE schemaname=\'public\'')).rows[0].count,'1');
 await db.query('DROP TABLE public.staging_drift_fixture');
 const applied=run(name);assert.equal(applied.status,0,applied.stderr);const ledger=(await db.query('SELECT version,filename,checksum_sha256 AS sha256 FROM schema_migrations ORDER BY version')).rows;assert.deepEqual(ledger,JSON.parse(await readFile('infra/cloud-run/migrations.sha256.json','utf8')));
 assert.notEqual(run(name).status,0);assert.deepEqual((await db.query('SELECT version,filename,checksum_sha256 AS sha256 FROM schema_migrations ORDER BY version')).rows,ledger);
 }finally{await db?.end();if(created)await maintenance.query(`DROP DATABASE "${name}"`);await maintenance.end();await rm(dir,{recursive:true,force:true});}
});
