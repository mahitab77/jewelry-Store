import assert from 'node:assert/strict';
import { afterEach,beforeEach,test } from 'node:test';
import { paymentFixture } from './helpers/payment-fixture.mts';
import { orderStatusData } from './helpers/order-status-data.mts';
import { cookieName,newToken } from '../src/lib/cart/session.ts';
import { orderHttp } from '../src/lib/payments/http.ts';

const origin='https://order-status.boutique.test';
const keys=['CART_DATABASE_URL','PAYMENT_DATABASE_URL','CART_ORIGIN','PAYMENTS_TEST_ENABLED'];
const old=new Map(keys.map(key=>[key,process.env[key]]));
let fixture:Awaited<ReturnType<typeof paymentFixture>>,token:string,reference:string,cartId:string;
beforeEach(async()=>{
  fixture=await paymentFixture(origin);token=newToken();
  Object.assign(process.env,{CART_DATABASE_URL:fixture.cartUrl,PAYMENT_DATABASE_URL:fixture.paymentUrl,CART_ORIGIN:origin,PAYMENTS_TEST_ENABLED:'false'});
  ({reference,cartId}=await orderStatusData(fixture.data,token));
},{timeout:60000});
afterEach(async()=>{if(fixture)await fixture.close();for(const[key,value]of old){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
async function access(credential:string|null=token,extra:Record<string,string>={},query='') {
  return orderHttp(new Request(origin+'/api/orders/'+reference+'/access'+query,{headers:{...(credential?{Cookie:cookieName()+'='+credential}:{}),...extra}}),[reference,'access']);
}
test('exact-order access proof is short, private, credential-free and does not change order or inventory state',async()=>{
  const before=(await fixture.data.query(`SELECT updated_at,payment_status FROM orders WHERE id=$1`,[reference])).rows;
  const stock=(await fixture.data.query('SELECT variant_id,on_hand,reserved,updated_at FROM inventory ORDER BY variant_id')).rows;
  const response=await access(),body=await response.json();assert.equal(response.status,200);
  assert.deepEqual(Object.keys(body).sort(),['reference','validForMs','verified']);assert.equal(body.reference,reference);assert.equal(body.verified,true);assert.ok(Number.isInteger(body.validForMs)&&body.validForMs>0&&body.validForMs<=5000);
  assert.equal(response.headers.get('Cache-Control'),'private, no-store, max-age=0');assert.equal(response.headers.get('Vary'),'Cookie');assert.equal(response.headers.get('Set-Cookie'),null);
  assert.ok(!JSON.stringify(body).includes(token));assert.deepEqual((await fixture.data.query('SELECT updated_at,payment_status FROM orders WHERE id=$1',[reference])).rows,before);
  assert.deepEqual((await fixture.data.query('SELECT variant_id,on_hand,reserved,updated_at FROM inventory ORDER BY variant_id')).rows,stock);
  for(const table of ['payments','payment_events','inventory_reservations'])assert.equal((await fixture.data.query(`SELECT count(*)::INTEGER AS count FROM ${table}`)).rows[0].count,0);
});
test('unknown, missing and switched guest credentials cannot obtain proof; cross-site and query requests remain rejected',async()=>{
  for(const credential of [null,newToken()])assert.equal((await access(credential)).status,404);
  assert.equal((await access(token,{'Sec-Fetch-Site':'cross-site'})).status,403);assert.equal((await access(token,{},'?unexpected=1')).status,400);
  await fixture.data.query("UPDATE carts SET status='EXPIRED' WHERE id=$1",[cartId]);assert.equal((await access()).status,404);
});
test('display permission never outlives either guest-order or active-cart expiry',async()=>{
  await fixture.data.query("UPDATE orders SET guest_access_expires_at=clock_timestamp()+INTERVAL '2 seconds' WHERE id=$1",[reference]);
  const short=await(await access()).json();assert.ok(short.validForMs>0&&short.validForMs<=2000);
  await fixture.data.query("UPDATE orders SET guest_access_expires_at=clock_timestamp()-INTERVAL '1 second' WHERE id=$1",[reference]);assert.equal((await access()).status,404);
  await fixture.data.query("UPDATE orders SET guest_access_expires_at=clock_timestamp()+INTERVAL '1 hour' WHERE id=$1",[reference]);
  await fixture.data.query("UPDATE carts SET expires_at=clock_timestamp()-INTERVAL '1 second',created_at=clock_timestamp()-INTERVAL '2 days' WHERE id=$1",[cartId]);assert.equal((await access()).status,404);
});
