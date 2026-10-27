import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { readAdminOrder } from '../../../../../lib/admin/orders/repository.ts';
import { OrderDetail } from '../../../../../components/admin/OrderDetail';
export const metadata={title:"Order detail | La Palme d'Or Gems"};
export default async function OrderPage({params}:{params:Promise<{id:string}>}){
  const {id}=await params;let order;
  try{order=await readAdminOrder(new Headers(await headers()),id);}
  catch{return <section><h1 className="font-display">Order unavailable</h1><p role="alert">This order could not be opened. Operational administrator access is required.</p><Link href="/admin">Administration</Link></section>;}
  if(!order)notFound();return <OrderDetail initial={order}/>;
}
