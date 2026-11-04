import { hashPassword,verifyPassword } from 'better-auth/crypto';
import sharp from 'sharp';
import { createHmac } from 'node:crypto';
import { preparePhoto } from '../src/lib/media/cloudinary.ts';
async function measure(name:string,iterations:number,operation:()=>Promise<unknown>){
  await operation();const cpu=process.cpuUsage(),start=performance.now();for(let i=0;i<iterations;i++)await operation();const used=process.cpuUsage(cpu);
  console.log(JSON.stringify({name,iterations,meanNodeProcessCpuMs:(used.user+used.system)/1000/iterations,wallMs:performance.now()-start,rssMiB:process.memoryUsage().rss/1048576,hostedCpuNotMeasured:true}));
}
const password='Synthetic readiness measurement only 42!',hash=await hashPassword(password);
await measure('administrator password verification',5,()=>verifyPassword({hash,password}));
await measure('HMAC SHA512 primitive',1000,async()=>createHmac('sha512','synthetic-fixture-key').update('synthetic-callback-fields').digest());
const bytes=await sharp({create:{width:2000,height:2500,channels:3,background:'#d9bd7a'}}).png().toBuffer();
await measure('secure five-megapixel image preparation',3,()=>preparePhoto(bytes,'image/png'));
