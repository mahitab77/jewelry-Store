import { actions,followUps,reasons,type OrderAction } from './types.ts';
export class OrderAdminError extends Error { readonly status:number; constructor(message:string,status=400){super(message);this.name='OrderAdminError';this.status=status;} }
export function fail(message:string,status=400):never {throw new OrderAdminError(message,status);}
export function uuid(value:unknown):string {if(typeof value!=='string'|| !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value))fail('Invalid reference.');return value.toLowerCase();}
export function object(value:unknown,keys:string[]):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))fail('Unexpected request fields.');return value as Record<string,unknown>;}
export function text(value:unknown,max:number,required=false):string {if(value===undefined&&!required)return '';if(typeof value!=='string'||value.trim().length>max||(required&&!value.trim())||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))fail('Review the required text and its length.');return value.trim();}
export function instant(value:unknown):string {if(typeof value!=='string'|| !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)fail('Use a valid UTC date and time.');return value;}
export function input(value:unknown){
  const base=object(value,['action','operationId','revision','notes','start','end','assignedAdminId','confirmed','recipient','occurredAt','reason','followUp','correctsEventId']);
  if(!actions.includes(base.action as OrderAction))fail('Unknown fulfillment action.');const action=base.action as OrderAction;
  const fields:Partial<Record<OrderAction,string[]>>={propose:['start','end'],confirm:['confirmed','assignedAdminId'],reschedule:['start','end','reason'],failed:['occurredAt','reason','followUp'],complete:['confirmed','recipient','occurredAt'],cancel:['confirmed'],correct:['correctsEventId']};
  object(base,['action','operationId','revision','notes',...(fields[action]??[])]);
  const operationId=uuid(base.operationId);const revision=text(base.revision,40,true);if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(revision))fail('Reload the order before making changes.');
  const notes=text(base.notes,1000,['note','acknowledge','correct'].includes(action));
  let start:string|null=null,end:string|null=null,occurredAt:string|null=null;
  if(['propose','reschedule'].includes(action)){start=instant(base.start);end=instant(base.end);if(end<=start)fail('The appointment must end after it starts.');}
  if(['complete','failed'].includes(action)){occurredAt=instant(base.occurredAt);if(Date.parse(occurredAt)>Date.now()+300000)fail('The attempt cannot be in the future.');}
  if(['confirm','complete','cancel'].includes(action)&&base.confirmed!==true)fail('Explicit confirmation is required.');
  const recipient=action==='complete'?text(base.recipient,100,true):null;
  const assignedAdminId=action==='confirm'?uuid(base.assignedAdminId):null;
  const reason=['reschedule','failed'].includes(action)?text(base.reason,40,true):null;
  if(reason&&!reasons.includes(reason as typeof reasons[number]))fail('Choose a supported operational reason.');
  if(reason==='OTHER'&&!notes)fail('Describe the operational reason in an internal note.');
  const followUp=action==='failed'?text(base.followUp,40,true):null;if(followUp&&!followUps.includes(followUp as typeof followUps[number]))fail('Choose a follow-up.');
  return {action,operationId,revision,notes,start,end,occurredAt,recipient,assignedAdminId,reason,followUp,correctsEventId:action==='correct'?uuid(base.correctsEventId):null};
}
