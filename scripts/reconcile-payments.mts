import { closeDatabase } from '../src/lib/db/client.ts';
import { closeVerifiedUnpaid,inspectPayment,listPaymentExceptions,listUnmatchedPaymentEvents,reconcilePayments } from '../src/lib/payments/service.ts';

try {
  const [command,...args]=process.argv.slice(2);
  if(command==='list' && args.length<=1){const limit=args.length?Number(args[0]):25;console.log(JSON.stringify({attempts:await listPaymentExceptions(limit),unmatchedEvents:await listUnmatchedPaymentEvents(limit)}));}
  else if(command==='run' && args.length<=1)console.log(JSON.stringify(await reconcilePayments(args.length?Number(args[0]):10)));
  else if(command==='inspect' && args.length===1)console.log(JSON.stringify({observed:await inspectPayment(args[0])}));
  else if(command==='close-unpaid' && args.length===3 && args[2]==='--confirm-provider-closed-unpaid'){
    const closed=await closeVerifiedUnpaid(args[0],args[1]);console.log(JSON.stringify({closed}));if(!closed)process.exitCode=1;
  }else throw new Error();
}catch{console.error('Payment reconciliation did not complete. Check configuration, provider availability and the documented operator procedure.');process.exitCode=1;}
finally{await closeDatabase();}
