import Link from 'next/link';
import { headers } from 'next/headers';
import { listOrders } from '../../../../lib/admin/orders/repository.ts';
import { OrdersList } from '../../../../components/admin/OrdersList';
export const metadata={title:"Orders | La Palme d'Or Gems"};
export default async function OrdersPage(){
  let initial;
  try{initial=await listOrders(new Headers(await headers()),{});}
  catch{return <section><h1 className="font-display">Orders unavailable</h1><p role="alert">Operational administrator access and a working order database are required.</p><Link href="/admin">Administration</Link></section>;}
  return <OrdersList initial={initial}/>;
}
