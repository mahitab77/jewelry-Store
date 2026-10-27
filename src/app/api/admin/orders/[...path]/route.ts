import { ordersHttp } from '../../../../../lib/admin/orders/http.ts';
export const runtime='nodejs';
export async function GET(request:Request,{params}:{params:Promise<{path:string[]}>}){return ordersHttp(request,(await params).path);}
export async function POST(request:Request,{params}:{params:Promise<{path:string[]}>}){return ordersHttp(request,(await params).path);}
