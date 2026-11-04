import { createRequire,builtinModules } from 'node:module';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename,join,resolve,sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { databaseConfig,isLoopback } from '../src/lib/db/config.ts';

// Optional local experiment, deliberately not a deployment command. Install the
// documented pinned tools outside this repository; no dependency is added here.
const repository=fileURLToPath(new URL('../',import.meta.url));let directory:string|undefined;
try{
  const url=process.env.TEST_DATABASE_URL??'',config=databaseConfig(url);
  if(!isLoopback(config.host??'')||process.env.NODE_ENV==='production')throw new Error('Use a disposable loopback TEST_DATABASE_URL.');
  const modules=process.env.CLOUDFLARE_PROBE_MODULES;if(!modules)throw new Error('Set CLOUDFLARE_PROBE_MODULES to the isolated adapter-tools node_modules directory.');
  const require=createRequire(join(resolve(modules),'../package.json')),{build}=require('esbuild'),{Miniflare,convertV4MiniflareOptions,Log}=require('miniflare');
  directory=await mkdtemp(join(tmpdir(),'la-palme-worker-probe-'));const marker=join(directory,'server-only.mjs');await writeFile(marker,'export {};');
  const source=(path:string)=>JSON.stringify(join(repository,path).replaceAll('\\','/'));
  const entries:Record<string,string>={
    crypto:`import {hashPassword} from 'better-auth/crypto';import{createHmac}from'node:crypto';export default{async fetch(){await hashPassword('Synthetic readiness fixture only 42!');return Response.json({hashed:true,hmac:createHmac('sha512','synthetic-fixture').update('fixture').digest('hex').length===128});}}`,
    sharedPool:`import{withDatabaseClient}from${source('src/lib/db/client.ts')};export default{async fetch(){try{await withDatabaseClient(c=>c.query('SELECT 1'));return Response.json({healthy:true});}catch{return Response.json({healthy:false},{status:503});}}}`,
    scopedPool:`import pg from'pg';import{databaseConfig}from${source('src/lib/db/config.ts')};export default{async fetch(){const pool=new pg.Pool({...databaseConfig(process.env.DATABASE_URL),max:1});try{await pool.query('SELECT 1');return Response.json({healthy:true});}catch{return Response.json({healthy:false},{status:503});}finally{await pool.end();}}}`,
    image:`import{preparePhoto}from${source('src/lib/media/cloudinary.ts')};export default{async fetch(request){try{const p=await preparePhoto(new Uint8Array(await request.arrayBuffer()),'image/png');return Response.json({prepared:p.width>=200});}catch{return Response.json({prepared:false},{status:503});}}}`,
  };
  const appRequire=createRequire(join(repository,'package.json')),sharp=appRequire('sharp'),png=await sharp({create:{width:200,height:200,channels:3,background:'#d9bd7a'}}).png().toBuffer();let failed=false;
  for(const[name,contents]of Object.entries(entries)){
    let worker;
    try{
      const output=join(directory,name+'.mjs');await build({stdin:{contents,resolveDir:repository},outfile:output,bundle:true,platform:'neutral',format:'esm',conditions:['workerd','worker','browser'],mainFields:['module','main'],external:[...builtinModules,...builtinModules.map(n=>'node:'+n),'pg-native','cloudflare:*'],alias:{'server-only':marker},define:{'import.meta.url':JSON.stringify('file:///readiness.mjs')},banner:{js:"import{createRequire as create}from'node:module';const require=create('file:///readiness.mjs');"},logLevel:'silent'});
      worker=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:output,compatibilityDate:'2026-10-27',compatibilityFlags:['nodejs_compat'],bindings:{DATABASE_URL:url},log:new Log(0)}));await worker.ready;
      if(name==='crypto'){
        await worker.dispatchFetch('http://readiness.test/');let cpu:(()=>number)|undefined;
        if(process.platform==='win32'){
          const child=Number(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`(Get-CimInstance Win32_Process -Filter "Name = 'workerd.exe'" | Where-Object ParentProcessId -eq ${process.pid} | Select-Object -First 1 -ExpandProperty ProcessId)`],{encoding:'utf8',windowsHide:true}).trim());
          if(child)cpu=()=>Number(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',`(Get-Process -Id ${child}).TotalProcessorTime.TotalMilliseconds`],{encoding:'utf8',windowsHide:true}).trim());
        }
        const before=cpu?.(),start=performance.now();for(let i=0;i<5;i++){const r=await worker.dispatchFetch('http://readiness.test/');if(r.status!==200)throw new Error();}
        const processCpuMs=before===undefined?null:cpu!()-before;console.log(JSON.stringify({probe:name,iterations:5,localWorkerdProcessCpuMs:processCpuMs,meanProcessCpuMs:processCpuMs===null?null:processCpuMs/5,wallMs:performance.now()-start,hostedCpuNotMeasured:true}));
      }else{
        const statuses:number[]=[];for(let i=0;i<3;i++)statuses.push((await worker.dispatchFetch('http://readiness.test/',name==='image'?{method:'POST',body:png}:{})).status);
        console.log(JSON.stringify({probe:name,statuses}));if(statuses.some(s=>s!==200))failed=true;
      }
    }catch{console.log(JSON.stringify({probe:name,result:'LOCAL_WORKER_FAILED',detail:'Build or local runtime initialization/execution failed; inspect the documented compatibility limits.'}));failed=true;}
    finally{await worker?.dispose().catch(()=>{});}
  }
  if(failed)process.exitCode=1;
}catch{console.error('Local Workers probe could not run. Check the documented isolated tools, loopback database and runtime requirements.');process.exitCode=1;}
finally{if(directory){const path=resolve(directory);if(!path.startsWith(resolve(tmpdir())+sep)||!basename(path).startsWith('la-palme-worker-probe-'))throw new Error('Unsafe probe cleanup target.');await rm(path,{recursive:true,force:true});}}
