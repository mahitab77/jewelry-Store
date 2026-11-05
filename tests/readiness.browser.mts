// Exercise retained direct-sales behavior; quotation-only denial has its own suites.
process.env.COMMERCE_MODE = "DIRECT_SALES";
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adminBrowserHarness } from './helpers/admin-browser.mts';
import { fixtureOrder,type orderFixture } from './helpers/order-fixture.mts';
const h=adminBrowserHarness(false,true,true,true);
test('unconfigured public deployment is nonindexable and sends browser security headers',async()=>{
  const c=await h.current().browser.newContext();try{
    const response=await c.request.get('http://127.0.0.1:3121/');assert.equal(response.status(),200);const headers=response.headers();
    assert.equal(headers['x-frame-options'],'DENY');assert.equal(headers['x-content-type-options'],'nosniff');assert.equal(headers['referrer-policy'],'no-referrer');assert.match(headers['permissions-policy'],/camera=\(\)/);assert.match(headers['x-robots-tag'],/noindex/);
    const robots=await c.request.get('http://127.0.0.1:3121/robots.txt');assert.equal(robots.status(),200);assert.match(await robots.text(),/Disallow: \//);
    const sitemap=await c.request.get('http://127.0.0.1:3121/sitemap.xml');assert.equal(sitemap.status(),200);assert.ok(!(await sitemap.text()).includes('<loc>'));
  }finally{await c.close();}
});
test('authorized order responses stay private and excluded from indexing behind HTTPS',async()=>{
  const f=h.current().fixture as Awaited<ReturnType<typeof orderFixture>>,a=await fixtureOrder(f),c=await h.current().browser.newContext({ignoreHTTPSErrors:true}),page=await c.newPage();
  try{await h.signIn(page);const response=await page.goto(h.origin+'/admin/orders/'+a.id);assert.match(response.headers()['cache-control'],/no-store/);assert.match(response.headers()['x-robots-tag'],/noindex/);assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'),'noindex, nofollow');
    const api=await page.request.get(h.origin+'/api/admin/orders/'+a.id);assert.equal(api.status(),200);assert.match(api.headers()['cache-control'],/private.*no-store/);assert.equal(api.headers()['referrer-policy'],'no-referrer');
    const cookies=await c.cookies();const session=cookies.find((cookie:{name:string})=>cookie.name.includes('.session_token'));assert.ok(session);h.trackSecret(session.value);assert.equal(session.secure,true);assert.equal(session.httpOnly,true);assert.equal(session.sameSite,'Strict');
  }finally{await c.close();}
});
