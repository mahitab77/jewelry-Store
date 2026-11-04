import 'server-only';
import type { Pool,PoolClient } from 'pg';
import type { MediaProvider } from './cloudinary.ts';
type Transaction=<T>(operation:(client:PoolClient,actor:string|null)=>Promise<T>)=>Promise<T>;

// Shared by the authenticated product action and operator-only background CLI.
// Provider I/O stays outside transactions. Existing attempts acts as a lease
// generation so an old worker cannot complete/audit a newer worker's claim.
export async function cleanupMediaBatch(transaction:Transaction,provider:MediaProvider,productId:string|null=null,limit=5){
  if(!Number.isInteger(limit)||limit<1||limit>50)throw new Error('Invalid media cleanup batch size.');
  let completed=0;
  for(let i=0;i<limit;i++){
    const job=await transaction(async client=>{
      const row=(await client.query(`SELECT * FROM catalogue_media_jobs WHERE ($1::UUID IS NULL OR product_id=$1)
        AND available_at<=clock_timestamp() AND state IN ('UPLOAD_PENDING','DELETE_PENDING','DELETING')
        ORDER BY available_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`,[productId])).rows[0];
      if(!row)return null;
      if((await client.query('SELECT id FROM product_media WHERE cloudinary_public_id=$1 LIMIT 1',[row.public_id])).rowCount){
        await client.query("UPDATE catalogue_media_jobs SET state='ATTACHED',updated_at=clock_timestamp() WHERE id=$1",[row.id]);return {...row,referenced:true};
      }
      await client.query("UPDATE catalogue_media_jobs SET state='DELETING',attempts=attempts+1,available_at=clock_timestamp()+INTERVAL '5 minutes',updated_at=clock_timestamp() WHERE id=$1",[row.id]);
      return {...row,attempts:row.attempts+1,referenced:false};
    });
    if(!job)break;if(job.referenced)continue;
    try{
      await provider.destroy(job.public_id);
      const finished=await transaction(async(client,actor)=>{
        const updated=await client.query("UPDATE catalogue_media_jobs SET state='DONE',updated_at=clock_timestamp() WHERE id=$1 AND state='DELETING' AND attempts=$2 RETURNING id",[job.id,job.attempts]);
        if(!updated.rowCount)return false;
        await client.query(`INSERT INTO audit_events(actor_kind,actor_admin_id,action,target_table,target_id,metadata)
          VALUES($1,$2,'CATALOGUE_MEDIA_CLEANED','products',$3,$4::JSONB)`,[actor?'ADMIN':'SYSTEM',actor,job.product_id,JSON.stringify({jobId:job.id})]);return true;
      });if(finished)completed++;
    }catch{/* Lease and durable state retain failed deletions for safe retry. */}
  }
  const pending=await transaction(async client=>Number((await client.query(`SELECT count(*) AS count FROM catalogue_media_jobs
    WHERE ($1::UUID IS NULL OR product_id=$1) AND state IN ('UPLOAD_PENDING','DELETE_PENDING','DELETING')`,[productId])).rows[0].count));
  return {completed,pending};
}
export async function systemMediaCleanup(pool:Pool,provider:MediaProvider,limit=25){
  const transaction:Transaction=async operation=>{const client=await pool.connect();try{await client.query('BEGIN');try{const result=await operation(client,null);await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK');throw error;}}finally{client.release();}};
  return cleanupMediaBatch(transaction,provider,null,limit);
}
