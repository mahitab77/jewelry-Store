import 'server-only';
import { AdminAccessError,requirePermission } from '../authorization.ts';
import { createLoginThrottle } from '../rate-limit.ts';
import { getAdminRuntime,type AdminRuntime } from '../runtime.ts';
import { changeOrder,listOrders,readAdminOrder } from './repository.ts';
import { fail,OrderAdminError } from './validation.ts';
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
async function body(request:Request){
  if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get('content-type')??''))fail('Use a JSON request.',415);
  const reader=request.body?.getReader();if(!reader)fail('A request body is required.');let size=0;const chunks:Uint8Array[]=[];
  try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>8192){await reader.cancel();fail('This request is too large.',413);}chunks.push(part.value);}}finally{reader.releaseLock();}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))) as unknown;}catch{fail('Invalid JSON request.');}
}
export async function ordersHttp(request:Request,path:string[],supplied?:AdminRuntime){
  try{
    const runtime=supplied??getAdminRuntime();const permission=request.method==='POST'&&path[0]!=='search'?'orders:manage_fulfillment':'orders:read';
    const actor=await requirePermission(permission,request.headers,runtime);
    if(new URL(request.url).search)fail('Query parameters are not accepted.');
    if(path.length!==1)return json({message:'Not found.'},404);
    if(request.method==='GET'&&path[0]!=='search'){const order=await readAdminOrder(request.headers,path[0],runtime);return order?json({order}):json({message:'Order not found.'},404);}
    if(request.method!=='POST')return json({message:'Use POST for changes or search.'},405);
    if(request.headers.get('origin')!==runtime.config.baseURL||request.headers.get('sec-fetch-site')==='cross-site')fail('This request could not be verified.',403);
    if(!(await createLoginThrottle(runtime.pool,runtime.config.secret)(`orders:${actor.id}`,{window:60,max:100})).allowed)return json({message:'Please wait before making more requests.'},429);
    const value=await body(request);
    if(path[0]==='search')return json(await listOrders(request.headers,value,runtime));
    const result=await changeOrder(request.headers,path[0],value,runtime);
    return json({...result,message:result.replayed?'This operation was already recorded.':'Operation recorded.'});
  }catch(error){if(error instanceof AdminAccessError)return json({message:'Operational administrator access is required.'},error.status);
    if(error instanceof OrderAdminError)return json({message:error.message},error.status);
    return json({message:'Orders are temporarily unavailable. Reload to check the current state before retrying.'},503);}
}
