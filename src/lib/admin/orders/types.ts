export const paymentStatuses = ['UNPAID','PENDING','PAID','FAILED','PARTIALLY_REFUNDED','REFUNDED'] as const;
export const fulfillmentStatuses = ['UNARRANGED','PREPARING','ARRANGING','SCHEDULED','IN_PROGRESS','READY','COMPLETED','CANCELLED'] as const;
export const reasons = ['CUSTOMER_UNAVAILABLE','DELIVERY_NOT_COMPLETED','COLLECTION_MISSED','CUSTOMER_RESCHEDULE','LOCATION_UNAVAILABLE','STAFF_RESCHEDULE','OTHER'] as const;
export const followUps = ['CONTACT_CUSTOMER','RESCHEDULE','LOCATION_REVIEW','STAFF_REVIEW'] as const;
export const actions = ['prepare','contact','propose','confirm','dispatch','ready','reschedule','failed','complete','cancel','note','acknowledge','correct'] as const;
export type OrderAction = typeof actions[number];
export interface OrderListRow { id:string; reference:string; createdAt:string; customerName:string; amountMinor:string; paymentStatus:string; method:string; fulfillmentStatus:string; exception:boolean }
export interface OrderList { items:OrderListRow[]; page:number; pageSize:number; hasMore:boolean }
export interface Arrangement { id:string; status:string; assignedAdminId:string|null; staffName:string|null; start:string|null; end:string|null; completedAt:string|null; completedBy:string|null; supersedesId:string|null }
export interface OperationalEvent { id:string; arrangementId:string|null; type:string; actorName:string|null; occurredAt:string; recordedAt:string; recipient:string|null; notes:string|null; reason:string|null; followUp:string|null; correctsEventId:string|null }
export interface AdminOrder extends OrderListRow {
  revision:string; orderStatus:string; testMode:boolean; subtotalMinor:string; discountMinor:string; taxMinor:string; feeMinor:string;
  email:string|null; phone:string; destination:string; instructions:string|null; locationActive:boolean; locationChanged:boolean;
  eligible:boolean; reconciliationReason:string|null; inventoryFinalized:boolean;
  items:{id:string;name:string;sku:string;configuration:string|null;quantity:number;unitMinor:string;totalMinor:string}[];
  payments:{id:string;status:string;amountMinor:string;transaction:string|null;createdAt:string;succeededAt:string|null;initiationState:string;errorCode:string|null}[];
  paymentEvents:{id:string;paymentId:string;status:string;verified:boolean;source:string|null;receivedAt:string;processedAt:string|null}[];
  arrangements:Arrangement[]; events:OperationalEvent[];
  history:{domain:string;from:string|null;to:string;at:string}[];
  audit:{id:string;action:string;actorName:string|null;at:string;metadata:Record<string,unknown>}[];
  staff:{id:string;name:string}[];
}
export function label(value:string) { return value.toLowerCase().replaceAll('_',' '); }
