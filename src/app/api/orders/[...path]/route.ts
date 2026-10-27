import { orderHttp } from '../../../../lib/payments/http.ts';
export const runtime='nodejs';
type Context={params:Promise<{path:string[]}>};
async function handle(request:Request,context:Context){return orderHttp(request,(await context.params).path);}
export {handle as GET,handle as POST};
