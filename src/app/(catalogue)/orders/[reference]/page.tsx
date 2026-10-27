import { connection } from 'next/server';
import { OrderStatus } from '../../../../components/checkout/OrderStatus';
export const metadata={title:"Order Status | La Palme d'Or Gems",robots:{index:false,follow:false},referrer:'no-referrer' as const};
export default async function OrderPage({params}:{params:Promise<{reference:string}>}) {
  await connection();const {reference}=await params;return <OrderStatus reference={reference}/>;
}
