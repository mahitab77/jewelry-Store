import 'server-only';
import { createHash,randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { AdminAccessError,requirePermission } from '../authorization.ts';
import { hasPermission,isAdminRole,type AdminPermission } from '../policy.ts';
import { getAdminRuntime,type AdminRuntime } from '../runtime.ts';
import { revisionColumn } from '../catalogue/transaction.ts';
import { fulfillmentStatuses,paymentStatuses,type AdminOrder,type OrderList } from './types.ts';
import { fail,input,object,OrderAdminError,text,uuid } from './validation.ts';

// Payment lifecycle locks the order before changing money/stock. Taking the same
// order lock serializes eligibility with callbacks without touching inventory.
const verifiedPayment=`EXISTS(SELECT 1 FROM payments p WHERE p.order_id=o.id AND p.status='SUCCEEDED'
  AND p.currency=o.currency AND p.amount_minor=o.total_minor AND p.refunded_minor=0
  AND p.provider_transaction_reference IS NOT NULL AND EXISTS(SELECT 1 FROM payment_events e
    WHERE e.payment_id=p.id AND e.status='PROCESSED' AND (e.signature_verified OR e.verification_source='PAYMOB_API')
    AND e.provider_transaction_reference=p.provider_transaction_reference))`;
const eligibility=`(o.payment_status='PAID' AND o.order_status='CONFIRMED' AND o.inventory_finalized_at IS NOT NULL
  AND NOT o.reconciliation_required AND ${verifiedPayment})`;
const exception=`(o.reconciliation_required OR o.payment_status IN ('PARTIALLY_REFUNDED','REFUNDED')
  OR (o.payment_status='PAID' AND (o.inventory_finalized_at IS NULL OR NOT ${verifiedPayment})))`;
const summary=`o.id,o.order_number AS reference,o.created_at AS "createdAt",o.customer_name AS "customerName",
  o.total_minor::TEXT AS "amountMinor",o.payment_status AS "paymentStatus",o.fulfillment_method AS method,
  o.fulfillment_status AS "fulfillmentStatus",${exception} AS exception`;

async function transaction<T>(headers:Headers,permission:AdminPermission,operation:(client:PoolClient,actor:string)=>Promise<T>,runtime:AdminRuntime){
  const admin=await requirePermission(permission,headers,runtime);
  // Exception information has a distinct authorization boundary, including lists.
  await requirePermission('orders:view_payment_exceptions',headers,runtime);
  const client=await runtime.pool.connect();
  try{
    await client.query('BEGIN');
    const row=(await client.query(`SELECT role FROM admin_users WHERE id=$1 AND is_active
      AND auth_provider='better-auth' AND auth_subject=id::TEXT FOR SHARE`,[admin.id])).rows[0];
    if(!row||!isAdminRole(row.role)||!hasPermission(row.role,permission)||!hasPermission(row.role,'orders:view_payment_exceptions'))throw new AdminAccessError(403);
    const result=await operation(client,admin.id);await client.query('COMMIT');return result;
  }catch(error){await client.query('ROLLBACK');if(error instanceof OrderAdminError||error instanceof AdminAccessError)throw error;
    if(['23505','23503','23001','23514','40001','40P01'].includes((error as {code?:string}).code??''))fail('The order changed or a referenced record is unavailable. Reload before retrying.',409);
    fail('The order operation could not be completed. No partial changes were committed.',503);
  }finally{client.release();}
}

export async function listOrders(headers:Headers,value:unknown,runtime:AdminRuntime=getAdminRuntime()):Promise<OrderList>{
  return transaction(headers,'orders:read',async client=>{
    const q=object(value,['reference','paymentStatus','fulfillmentStatus','method','from','to','page','pageSize']);
    const page=q.page??1,pageSize=q.pageSize??20;
    if(!Number.isInteger(page)||Number(page)<1||Number(page)>1000||!Number.isInteger(pageSize)||Number(pageSize)<1||Number(pageSize)>50)fail('Invalid page selection.');
    const where:string[]=[],params:unknown[]=[];
    const add=(sql:string,value:unknown)=>{params.push(value);where.push(sql.replace('?',`$${params.length}`));};
    const reference=text(q.reference,80);if(reference)add('o.order_number=?',reference);
    for(const[key,column,values]of [['paymentStatus','payment_status',paymentStatuses],['fulfillmentStatus','fulfillment_status',fulfillmentStatuses],['method','fulfillment_method',['PRIVATE_DELIVERY','BOUTIQUE_COLLECTION']]] as const){
      if(q[key]!==undefined&&q[key]!==''){if(!values.some(v=>v===q[key]))fail('Invalid order filter.');add(`o.${column}=?`,q[key]);}
    }
    for(const key of ['from','to'])if(q[key]!==undefined&&q[key]!==''){
      if(typeof q[key]!=='string'||!/^\d{4}-\d\d-\d\d$/.test(q[key])||!Number.isFinite(Date.parse(q[key]+'T00:00:00.000Z'))||new Date(q[key]+'T00:00:00.000Z').toISOString().slice(0,10)!==q[key])fail('Use a valid date range.');
      add(key==='from'?"o.created_at >= ?::DATE::TIMESTAMP AT TIME ZONE 'UTC'":"o.created_at < (?::DATE + 1)::TIMESTAMP AT TIME ZONE 'UTC'",q[key]);
    }
    if(q.from&&q.to&&String(q.from)>String(q.to))fail('The end date must follow the start date.');
    params.push(Number(pageSize)+1,(Number(page)-1)*Number(pageSize));
    const rows=(await client.query(`SELECT ${summary} FROM orders o ${where.length?'WHERE '+where.join(' AND '):''}
      ORDER BY o.created_at DESC,o.id DESC LIMIT $${params.length-1} OFFSET $${params.length}`,params)).rows;
    return {items:rows.slice(0,Number(pageSize)),hasMore:rows.length>Number(pageSize),page:Number(page),pageSize:Number(pageSize)};
  },runtime);
}

async function detail(client:PoolClient,id:string):Promise<AdminOrder|null>{
  const o=(await client.query(`SELECT ${summary},${revisionColumn.replaceAll('updated_at','o.updated_at')} AS revision,
    o.order_status AS "orderStatus",o.test_mode AS "testMode",o.subtotal_minor::TEXT AS "subtotalMinor",o.discount_minor::TEXT AS "discountMinor",
    o.tax_minor::TEXT AS "taxMinor",o.fulfillment_fee_minor::TEXT AS "feeMinor",o.customer_email AS email,o.customer_phone AS phone,
    o.reconciliation_reason AS "reconciliationReason",o.inventory_finalized_at IS NOT NULL AS "inventoryFinalized",${eligibility} AS eligible,
    CASE WHEN o.fulfillment_method='PRIVATE_DELIVERY' THEN concat_ws(', ',a.recipient_name,a.street_address,a.building,a.floor_unit,a.landmark,a.city_area,a.governorate,'Egypt')
      ELSE concat_ws(', ',o.boutique_location_snapshot->>'name',o.boutique_location_snapshot->>'street',o.boutique_location_snapshot->>'city',o.boutique_location_snapshot->>'governorate','Egypt') END AS destination,
    a.delivery_instructions AS instructions,
    (o.fulfillment_method='PRIVATE_DELIVERY' OR COALESCE(b.is_active,false)) AS "locationActive",
    (o.fulfillment_method='BOUTIQUE_COLLECTION' AND (b.id IS NULL OR b.name IS DISTINCT FROM o.boutique_location_snapshot->>'name'
      OR b.street_address IS DISTINCT FROM o.boutique_location_snapshot->>'street' OR b.city_area IS DISTINCT FROM o.boutique_location_snapshot->>'city'
      OR b.governorate IS DISTINCT FROM o.boutique_location_snapshot->>'governorate')) AS "locationChanged"
    FROM orders o LEFT JOIN order_addresses a ON a.order_id=o.id LEFT JOIN boutique_locations b ON b.id=o.boutique_location_id WHERE o.id=$1 FOR SHARE OF o`,[id])).rows[0];
  if(!o)return null;
  const items=(await client.query(`SELECT id,product_name_snapshot AS name,sku_snapshot AS sku,configuration_snapshot AS configuration,quantity,
    unit_price_minor::TEXT AS "unitMinor",line_total_minor::TEXT AS "totalMinor" FROM order_items WHERE order_id=$1 ORDER BY created_at,id`,[id])).rows;
  // Explicit safe columns: never checkout_client_secret or verified_payload.
  const payments=(await client.query(`SELECT id,status,amount_minor::TEXT AS "amountMinor",provider_transaction_reference AS transaction,
    created_at AS "createdAt",succeeded_at AS "succeededAt",initiation_state AS "initiationState",last_error_code AS "errorCode"
    FROM payments WHERE order_id=$1 ORDER BY created_at,id`,[id])).rows;
  const paymentEvents=(await client.query(`SELECT e.id,e.payment_id AS "paymentId",e.status,(e.signature_verified OR COALESCE(e.verification_source='PAYMOB_API',false)) AS verified,
    e.verification_source AS source,e.received_at AS "receivedAt",e.processed_at AS "processedAt" FROM payment_events e JOIN payments p ON p.id=e.payment_id WHERE p.order_id=$1 ORDER BY e.received_at,e.id`,[id])).rows;
  const arrangements=(await client.query(`SELECT a.id,a.status,a.assigned_admin_id AS "assignedAdminId",u.display_name AS "staffName",a.scheduled_start_at AS start,a.scheduled_end_at AS end,
    a.completed_at AS "completedAt",v.display_name AS "completedBy",a.supersedes_id AS "supersedesId" FROM fulfillment_arrangements a
    LEFT JOIN admin_users u ON u.id=a.assigned_admin_id LEFT JOIN admin_users v ON v.id=a.completed_by_admin_id WHERE a.order_id=$1 ORDER BY a.created_at,a.id`,[id])).rows;
  const events=(await client.query(`SELECT e.id,e.arrangement_id AS "arrangementId",e.event_type AS type,u.display_name AS "actorName",e.occurred_at AS "occurredAt",e.recorded_at AS "recordedAt",
    e.handover_recipient_name AS recipient,e.notes,e.reason_code AS reason,e.follow_up AS "followUp",e.corrects_event_id AS "correctsEventId"
    FROM fulfillment_events e LEFT JOIN admin_users u ON u.id=e.actor_admin_id WHERE e.order_id=$1 ORDER BY e.recorded_at,e.id`,[id])).rows;
  const history=(await client.query(`SELECT state_domain AS domain,from_status AS "from",to_status AS "to",created_at AS at FROM order_status_history WHERE order_id=$1 ORDER BY created_at,id`,[id])).rows;
  const audit=(await client.query(`SELECT a.id,a.action,u.display_name AS "actorName",a.created_at AS at,
    jsonb_build_object('arrangementId',a.metadata->'arrangementId','from',a.metadata->'from','to',a.metadata->'to','eventId',a.metadata->'eventId','reason',a.metadata->'reason',
      'start',a.metadata->'start','end',a.metadata->'end','assignedAdminId',a.metadata->'assignedAdminId') AS metadata
    FROM audit_events a LEFT JOIN admin_users u ON u.id=a.actor_admin_id WHERE a.target_table='orders' AND a.target_id=$1 ORDER BY a.created_at,a.id`,[id])).rows;
  const staff=(await client.query(`SELECT id,display_name AS name FROM admin_users WHERE is_active AND role IN ('OWNER','ADMIN') AND auth_provider='better-auth' AND auth_subject=id::TEXT ORDER BY display_name,id LIMIT 200`)).rows;
  return JSON.parse(JSON.stringify({...o,items,payments,paymentEvents,arrangements,events,history,audit,staff})) as AdminOrder;
}
export async function readAdminOrder(headers:Headers,id:string,runtime:AdminRuntime=getAdminRuntime()){
  return transaction(headers,'orders:read',client=>detail(client,uuid(id)),runtime);
}

export async function changeOrder(headers:Headers,id:string,value:unknown,runtime:AdminRuntime=getAdminRuntime()){
  return transaction(headers,'orders:manage_fulfillment',async(client,actor)=>{
    id=uuid(id);const d=input(value);
    const o=(await client.query(`SELECT id,fulfillment_status AS stage,fulfillment_method AS method,order_status,created_at,
      reconciliation_required,boutique_location_id,${revisionColumn} AS revision,${eligibility} AS eligible FROM orders o WHERE id=$1 FOR UPDATE`,[id])).rows[0];
    if(!o)fail('Order not found.',404);
    const fingerprint=createHash('sha256').update(JSON.stringify({id,actor,...d})).digest('hex');
    const previous=(await client.query('SELECT order_id,actor_admin_id,operation_fingerprint FROM fulfillment_events WHERE operation_id=$1',[d.operationId])).rows[0];
    if(previous){if(previous.order_id!==id||previous.actor_admin_id!==actor||previous.operation_fingerprint!==fingerprint)fail('This operation reference has already been used.',409);return {replayed:true};}
    if(o.revision!==d.revision)fail('This order changed in another session. Reload and review it before retrying.',409);
    const active=(await client.query(`SELECT * FROM fulfillment_arrangements WHERE order_id=$1 AND status NOT IN ('CANCELLED','RESCHEDULED') FOR UPDATE`,[id])).rows[0];
    let arrangementId:string|null=active?.id??null,next=o.stage,eventType='';const occurredAt=d.occurredAt;
    const administrative=['note','acknowledge','correct'].includes(d.action);
    if(!administrative&&(!o.eligible||o.order_status!=='CONFIRMED'))fail('Verified payment, finalized purchased stock and a clear reconciliation state are required.',409);
    if(!administrative&&(o.stage==='COMPLETED'||active?.status==='COMPLETED'))fail('Completed handovers cannot be changed. Append a correction instead.',409);
    if(occurredAt&&Date.parse(occurredAt)<o.created_at.getTime())fail('The attempt cannot predate the order.');
    if(d.start&&Date.parse(d.start)<o.created_at.getTime())fail('The appointment cannot predate the order.');
    if(o.method==='BOUTIQUE_COLLECTION'&&['confirm','ready','complete'].includes(d.action)){
      const l=(await client.query('SELECT is_active FROM boutique_locations WHERE id=$1 FOR SHARE',[o.boutique_location_id])).rows[0];
      if(!l?.is_active)fail('The original collection location is unavailable. Record a location issue and arrange follow-up.',409);
    }
    const requireState=(stages:string[],statuses:string[])=>{if(!stages.includes(o.stage)||!active||!statuses.includes(active.status))fail('This action is not available in the current fulfillment state.',409);};
    async function successor(supersedes:string|null,start:string|null=null,end:string|null=null){
      const address=(await client.query('SELECT id FROM order_addresses WHERE order_id=$1',[id])).rows[0];
      const result=(await client.query(`INSERT INTO fulfillment_arrangements(order_id,method,supersedes_id,assigned_admin_id,boutique_location_id,delivery_address_id,scheduled_start_at,scheduled_end_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,[id,o.method,supersedes,actor,o.method==='BOUTIQUE_COLLECTION'?o.boutique_location_id:null,o.method==='PRIVATE_DELIVERY'?address?.id:null,start,end])).rows[0];return result.id as string;
    }
    switch(d.action){
      case 'prepare':{
        if(!['UNARRANGED','CANCELLED'].includes(o.stage)||active)fail('Preparation has already started or is unavailable.',409);
        const last=(await client.query(`SELECT id FROM fulfillment_arrangements WHERE order_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1`,[id])).rows[0];
        arrangementId=await successor(last?.id??null);next='PREPARING';eventType='PREPARING';break;
      }
      case 'contact':requireState(['PREPARING'],['REQUESTED']);next='ARRANGING';eventType='CONTACTED';break;
      case 'propose':requireState(['ARRANGING'],['REQUESTED']);await client.query(`UPDATE fulfillment_arrangements SET scheduled_start_at=$2,scheduled_end_at=$3,updated_at=clock_timestamp() WHERE id=$1`,[active.id,d.start,d.end]);eventType='SCHEDULE_PROPOSED';break;
      case 'confirm':{
        requireState(['ARRANGING'],['REQUESTED']);if(!active.scheduled_start_at)fail('Propose an appointment before confirming it.',409);
        const staff=(await client.query(`SELECT id FROM admin_users WHERE id=$1 AND is_active AND role IN ('OWNER','ADMIN') AND auth_provider='better-auth' AND auth_subject=id::TEXT FOR SHARE`,[d.assignedAdminId])).rows[0];
        if(!staff)fail('Choose an enabled operational administrator.');
        await client.query(`UPDATE fulfillment_arrangements SET status='CONFIRMED',assigned_admin_id=$2,updated_at=clock_timestamp() WHERE id=$1`,[active.id,d.assignedAdminId]);next='SCHEDULED';eventType='CONFIRMED';break;
      }
      case 'dispatch':case 'ready':{
        requireState(['SCHEDULED'],['CONFIRMED']);if((d.action==='dispatch')!==(o.method==='PRIVATE_DELIVERY'))fail('This action does not match the fulfillment method.',409);
        await client.query(`UPDATE fulfillment_arrangements SET status='IN_PROGRESS',updated_at=clock_timestamp() WHERE id=$1`,[active.id]);next=d.action==='dispatch'?'IN_PROGRESS':'READY';eventType=d.action==='dispatch'?'STARTED':'READY';break;
      }
      case 'reschedule':case 'failed':{
        requireState(d.action==='failed'?['SCHEDULED','IN_PROGRESS','READY']:['PREPARING','ARRANGING','SCHEDULED','IN_PROGRESS','READY'],d.action==='failed'?['CONFIRMED','IN_PROGRESS']:['REQUESTED','CONFIRMED','IN_PROGRESS']);
        if((d.reason==='COLLECTION_MISSED'&&o.method!=='BOUTIQUE_COLLECTION')||(d.reason==='DELIVERY_NOT_COMPLETED'&&o.method!=='PRIVATE_DELIVERY'))fail('Choose a reason matching the fulfillment method.');
        await client.query(`UPDATE fulfillment_arrangements SET status='RESCHEDULED',updated_at=clock_timestamp() WHERE id=$1`,[active.id]);
        const replacement=await successor(active.id,d.start,d.end);
        await client.query(`INSERT INTO fulfillment_events(order_id,arrangement_id,event_type,actor_kind,actor_admin_id) VALUES($1,$2,'REQUESTED','ADMIN',$3)`,[id,replacement,actor]);
        next='ARRANGING';eventType=d.action==='failed'?'ATTEMPT_FAILED':'RESCHEDULED';break;
      }
      case 'complete':{
        requireState([o.method==='PRIVATE_DELIVERY'?'IN_PROGRESS':'READY'],['IN_PROGRESS']);
        await client.query(`UPDATE fulfillment_arrangements SET status='COMPLETED',completed_at=$2,completed_by_admin_id=$3,updated_at=clock_timestamp() WHERE id=$1`,[active.id,d.occurredAt,actor]);
        next='COMPLETED';eventType='HANDOVER_COMPLETED';
        await client.query(`UPDATE orders SET order_status='COMPLETED' WHERE id=$1`,[id]);
        await client.query(`INSERT INTO order_status_history(order_id,state_domain,from_status,to_status,actor_kind,actor_admin_id,reason) VALUES($1,'ORDER',$2,'COMPLETED','ADMIN',$3,'HANDOVER_COMPLETED')`,[id,o.order_status,actor]);break;
      }
      case 'cancel':requireState(['PREPARING','ARRANGING','SCHEDULED','IN_PROGRESS','READY'],['REQUESTED','CONFIRMED','IN_PROGRESS']);await client.query(`UPDATE fulfillment_arrangements SET status='CANCELLED',updated_at=clock_timestamp() WHERE id=$1`,[active.id]);next='CANCELLED';eventType='CANCELLED';break;
      case 'note':eventType='NOTE';break;
      case 'acknowledge':if(!o.reconciliation_required)fail('There is no unresolved Phase 09 reconciliation flag to acknowledge.',409);eventType='EXCEPTION_ACKNOWLEDGED';break;
      case 'correct':if(!(await client.query('SELECT id FROM fulfillment_events WHERE id=$1 AND order_id=$2',[d.correctsEventId,id])).rowCount)fail('Choose an existing event from this order.');eventType='CORRECTION';break;
    }
    const eventId=randomUUID();
    await client.query(`INSERT INTO fulfillment_events(id,order_id,arrangement_id,event_type,actor_kind,actor_admin_id,operation_id,operation_fingerprint,occurred_at,handover_recipient_name,notes,reason_code,follow_up,corrects_event_id)
      VALUES($1,$2,$3,$4,'ADMIN',$5,$6,$7,COALESCE($8::TIMESTAMPTZ,clock_timestamp()),$9,$10,$11,$12,$13)`,[eventId,id,arrangementId,eventType,actor,d.operationId,fingerprint,occurredAt,d.recipient,d.notes||null,d.reason,d.followUp,d.correctsEventId]);
    if(next!==o.stage)await client.query(`INSERT INTO order_status_history(order_id,state_domain,from_status,to_status,actor_kind,actor_admin_id,reason) VALUES($1,'FULFILLMENT',$2,$3,'ADMIN',$4,$5)`,[id,o.stage,next,actor,eventType]);
    await client.query(`UPDATE orders SET fulfillment_status=$2,updated_at=GREATEST(clock_timestamp(),updated_at+INTERVAL '1 microsecond') WHERE id=$1`,[id,next]);
    await client.query(`INSERT INTO audit_events(actor_kind,actor_admin_id,action,target_table,target_id,metadata) VALUES('ADMIN',$1,$2,'orders',$3,$4::JSONB)`,[actor,'ORDER_'+eventType,id,JSON.stringify({arrangementId,eventId,from:o.stage,to:next,reason:d.reason,
      start:d.start??active?.scheduled_start_at??null,end:d.end??active?.scheduled_end_at??null,assignedAdminId:d.assignedAdminId??active?.assigned_admin_id??actor})]);
    return {replayed:false};
  },runtime);
}
