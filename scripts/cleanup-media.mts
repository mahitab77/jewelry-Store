import pg from 'pg';
import { databaseConfig } from '../src/lib/db/config.ts';
import { cloudinaryProvider } from '../src/lib/media/cloudinary.ts';
import { systemMediaCleanup } from '../src/lib/media/cleanup.ts';
let pool:pg.Pool|undefined;
try{
  if(process.argv.length>3)throw new Error();const limit=process.argv[2]===undefined?25:Number(process.argv[2]);
  if(!Number.isInteger(limit)||limit<1||limit>50)throw new Error();
  const provider=cloudinaryProvider();pool=new pg.Pool(databaseConfig(process.env.MEDIA_CLEANUP_DATABASE_URL??''));
  const result=await systemMediaCleanup(pool,provider,limit);console.log(JSON.stringify(result));if(result.pending)process.exitCode=2;
}catch{console.error('Media cleanup did not complete. Inspect the protected job backlog, provider configuration and documented grants.');process.exitCode=1;}
finally{await pool?.end();}
