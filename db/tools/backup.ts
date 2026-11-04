import 'server-only';
import { createCipheriv,createDecipheriv,randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream,createWriteStream } from 'node:fs';
import { appendFile,mkdtemp,open,realpath,rm,stat } from 'node:fs/promises';
import { basename,dirname,isAbsolute,join,relative,resolve,sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import pg from 'pg';
import { databaseConfig } from '../../src/lib/db/config.ts';
import { localDatabaseConfig } from './local.ts';

const root=fileURLToPath(new URL('../../',import.meta.url)),magic=Buffer.from('LPDG1\0');
export class BackupError extends Error {constructor(){super('Backup or isolated restore did not complete. Check the protected paths, encryption key, PostgreSQL tools and documented procedure.');this.name='BackupError';}}
function key(value:string){if(!/^[A-Za-z0-9_-]{43}$/.test(value))throw new BackupError();const bytes=Buffer.from(value,'base64url');if(bytes.length!==32||bytes.toString('base64url')!==value)throw new BackupError();return bytes;}
async function outsideRepository(path:string){
  if(!isAbsolute(path))throw new BackupError();const directory=await realpath(dirname(path)),repository=await realpath(root);
  const result=join(directory,basename(path)),rel=relative(repository,result);
  if(!rel||(!rel.startsWith('..'+sep)&&rel!=='..'&&!isAbsolute(rel)))throw new BackupError();return result;
}
function environment(url:string,readOnly:boolean){
  // libpq PGHOSTADDR/PGSERVICE/etc must not redirect a validated destination.
  const inherited=Object.fromEntries(Object.entries(process.env).filter(([name])=>!/^PG/i.test(name)));
  const c=databaseConfig(url);return {...inherited,NODE_ENV:process.env.NODE_ENV,PGHOST:c.host,PGPORT:String(c.port),PGDATABASE:c.database,PGUSER:c.user,PGPASSWORD:typeof c.password==='string'?c.password:'',
    PGSSLMODE:c.ssl?'verify-full':'disable',PGCONNECT_TIMEOUT:'5',
    ...(c.ssl&&process.env.PGSSLROOTCERT?{PGSSLROOTCERT:process.env.PGSSLROOTCERT}:{}),
    PGCHANNELBINDING:new URL(url).searchParams.get('channel_binding')??'prefer',
    PGOPTIONS:`-c statement_timeout=300000 -c lock_timeout=5000${readOnly?' -c default_transaction_read_only=on':''}`};
}
function tool(bin:string,name:string,args:string[],env:NodeJS.ProcessEnv){
  if(!isAbsolute(bin))throw new BackupError();
  const child=spawn(join(bin,process.platform==='win32'?name+'.exe':name),args,{env,windowsHide:true,stdio:['pipe','pipe','pipe'],shell:false});
  // Provider/driver stderr can contain sensitive identifiers. Never forward it.
  child.stderr.resume();const timeout=setTimeout(()=>child.kill(),300000);
  const finished=new Promise<void>((done,reject)=>{child.once('error',()=>reject(new BackupError()));child.once('close',code=>code===0?done():reject(new BackupError()));}).finally(()=>clearTimeout(timeout));
  return {child,finished};
}

// Read-only source access; output is authenticated ciphertext, never a plaintext
// database dump. Invoked only by an operator CLI, never by an application route.
export async function backupDatabase(url:string,output:string,encryptionKey:string,pgBin:string){
  let destination:string|undefined,created=false;
  try{
    const secret=key(encryptionKey),env=environment(url,true);destination=await outsideRepository(output);
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',secret,iv),header=Buffer.concat([magic,iv]);cipher.setAAD(magic);
    const handle=await open(destination,'wx',0o600);created=true;await handle.writeFile(header);await handle.close();
    const {child,finished}=tool(pgBin,'pg_dump',['--format=custom','--no-owner','--no-privileges'],env);child.stdin.end();
    const results=await Promise.allSettled([pipeline(child.stdout,cipher,createWriteStream(destination,{flags:'a',mode:0o600})),finished]);
    if(results.some(r=>r.status==='rejected')){child.kill();throw new BackupError();}
    await appendFile(destination,cipher.getAuthTag());return {bytes:(await stat(destination)).size};
  }catch{if(created&&destination)await rm(destination,{force:true});throw new BackupError();}
}

// Restore creates a fresh explicitly named loopback database. It never reuses an
// existing database, even an empty one. Remote migration protection is unchanged.
export async function restoreLocalBackup(url:string,input:string,encryptionKey:string,pgBin:string){
  let temporary:string|undefined;let pool:pg.Pool|undefined;
  try{
    const config=localDatabaseConfig(url);if(!/^lapalme_test_restore_[a-z0-9_]+$/.test(config.database??'')||(config.database?.length??0)>63)throw new BackupError();
    const secret=key(encryptionKey),source=await outsideRepository(input),info=await stat(source);
    if(!info.isFile()||info.size<=magic.length+12+16)throw new BackupError();
    const handle=await open(source,'r');const header=Buffer.alloc(magic.length+12),tag=Buffer.alloc(16);
    try{await handle.read(header,0,header.length,0);await handle.read(tag,0,16,info.size-16);}finally{await handle.close();}
    if(!header.subarray(0,magic.length).equals(magic))throw new BackupError();
    temporary=await mkdtemp(join(tmpdir(),'la-palme-restore-'));
    const archive=join(temporary,'archive.dump'),decipher=createDecipheriv('aes-256-gcm',secret,header.subarray(magic.length));decipher.setAAD(magic);decipher.setAuthTag(tag);
    // Authenticate the complete archive BEFORE connecting to the restore target.
    // A private temporary plaintext file permits bounded-memory authentication;
    // it is removed in finally, including on bad tags and pg_restore failures.
    await pipeline(createReadStream(source,{start:header.length,end:info.size-17}),decipher,createWriteStream(archive,{flags:'wx',mode:0o600}));
    pool=new pg.Pool({...config,database:'postgres'});const client=await pool.connect();
    try{
      if((await client.query('SELECT 1 FROM pg_database WHERE datname=$1',[config.database])).rowCount)throw new BackupError();
      // The strict name allowlist above makes this identifier safe. CREATE is
      // atomic if two operators choose the same name; neither can overwrite it.
      await client.query(`CREATE DATABASE "${config.database}"`);
    }finally{client.release();}
    const {child,finished}=tool(pgBin,'pg_restore',['--single-transaction','--exit-on-error','--no-owner','--no-privileges','--dbname',config.database!],environment(url,false));child.stdout.resume();
    const results=await Promise.allSettled([pipeline(createReadStream(archive),child.stdin),finished]);
    if(results.some(r=>r.status==='rejected')){child.kill();throw new BackupError();}
    return {restored:true};
  }catch{throw new BackupError();}
  finally{await pool?.end();if(temporary){const directory=resolve(temporary);if(!directory.startsWith(resolve(tmpdir())+sep)||!basename(directory).startsWith('la-palme-restore-'))throw new BackupError();await rm(directory,{recursive:true,force:true});}}
}
