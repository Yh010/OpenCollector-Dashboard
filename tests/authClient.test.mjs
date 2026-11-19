import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DashboardSession } from '../src/authClient.ts';
const config = { supabaseUrl:'https://identity.example', publicKey:'public', api:'https://collector.example' };
const storage = () => { const values = new Map(); return { getItem:k=>values.get(k)??null, setItem:(k,v)=>values.set(k,String(v)), removeItem:k=>values.delete(k), values }; };
const tokens = { access_token:'private-access', refresh_token:'rotated-refresh', expires_in:3600, provider_token:'must-not-persist' };
test('the browser fetch function retains its global receiver', async () => {
  const store=storage();store.setItem('opencollector.refresh','old');
  const session=new DashboardSession(config,store,function(){assert.equal(this,globalThis);return Promise.resolve(Response.json(tokens))});
  assert.equal(await session.token(),'private-access');
});
test('PKCE callback is tied to this tab and stores only the refresh token', async () => {
  const store=storage(); let exchange;
  const session=new DashboardSession(config,store,async (url,options)=>{ exchange=JSON.parse(options.body); return Response.json(tokens); });
  const login=new URL(await session.loginUrl('https://dashboard.example'));
  const pending=JSON.parse(store.getItem('opencollector.pkce'));
  assert.equal(login.searchParams.get('code_challenge_method'),'s256');
  assert.ok(!login.href.includes(pending.verifier));
  const callback=new URL(login.searchParams.get('redirect_to'));callback.searchParams.set('code','one-time-code');
  assert.equal(await session.restore(callback),true);
  assert.deepEqual(exchange,{auth_code:'one-time-code',code_verifier:pending.verifier});
  assert.deepEqual([...store.values.values()],['rotated-refresh']);
  assert.equal(await session.token(),'private-access');
});
test('foreign and duplicated callbacks never reach the token endpoint', async () => {
  for (const change of [url=>{url.pathname='/auth/callback/foreign'},url=>{url.searchParams.append('code','second')}]) {
    const store=storage(); const session=new DashboardSession(config,store,async()=>assert.fail('must not exchange'));
    const login=new URL(await session.loginUrl('https://dashboard.example'));const url=new URL(login.searchParams.get('redirect_to'));url.searchParams.set('code','first');change(url);
    await assert.rejects(session.restore(url),/did not complete/);
  }
});
test('concurrent refreshes share one exchange and rotate the saved refresh token', async () => {
  const store=storage(); store.setItem('opencollector.refresh','old');let calls=0;
  const session=new DashboardSession(config,store,async (_url,options)=>{calls++;assert.equal(JSON.parse(options.body).refresh_token,'old');await new Promise(r=>setTimeout(r,10));return Response.json(tokens)});
  assert.deepEqual(await Promise.all([session.token(),session.token()]),['private-access','private-access']);assert.equal(calls,1);assert.equal(store.getItem('opencollector.refresh'),'rotated-refresh');
});
test('requests carry bearer headers, refuse other origins, and clear denied sessions', async () => {
  const store=storage();store.setItem('opencollector.refresh','old');let requested=0;
  const session=new DashboardSession(config,store,async(url,options)=>{
    if(String(url).startsWith(config.supabaseUrl))return Response.json(tokens);
    requested++;assert.equal(options.headers.get('Authorization'),'Bearer private-access');assert.equal(options.redirect,'error');return new Response('sensitive body',{status:403});
  });
  await assert.rejects(session.fetch('https://evil.example/v1/telemetry/traces'),/another service/);assert.equal(requested,0);
  await assert.rejects(session.fetch('https://collector.example/v1/telemetry/traces'),/does not have dashboard access/);assert.equal(store.getItem('opencollector.refresh'),null);
});
test('logout cannot be undone by an in-flight token exchange',async()=>{
  const store=storage();store.setItem('opencollector.refresh','old');let release;
  const session=new DashboardSession(config,store,()=>new Promise(resolve=>{release=resolve}));
  const pending=session.token();await session.logout();release(Response.json(tokens));await assert.rejects(pending,/cancelled/);assert.equal(store.getItem('opencollector.refresh'),null);
});
