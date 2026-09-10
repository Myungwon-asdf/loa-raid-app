import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../api/lostark-sync.js';
const now=Date.parse('2026-09-10T12:00:00Z');
const profile={ArmoryProfile:{CharacterName:'테스트',CharacterClassName:'바드',ItemAvgLevel:'1,700'}};
const row={id:'c1',name:'테스트',item_level:1700,completed_raids:['raid1'],api_synced_at:null};
const response=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers});
async function call(handler,body,method='POST') {
  const result={headers:{}};
  const res={setHeader(k,v){result.headers[k]=v;},status(s){result.status=s;return this;},json(b){result.body=b;return this;}};
  await handler({method,body},res);return result;
}
test('reject non-string character names before external requests',async()=>{
  const handler=createHandler({fetchImpl:()=>{throw Error('must not fetch');}});
  for(const name of [123,{},'', 'a/b']) assert.equal((await call(handler,{characterName:name})).status,400);
  assert.equal((await call(handler,{},'GET')).status,405);
});
test('malformed upstream data never writes to database',async()=>{
  let writes=0;
  const handler=createHandler({apiKey:()=> 'test',fetchImpl:async(url,options)=>{
    if(options.method==='PATCH') writes++;
    return response(url.includes('/rest/')?[row]:{ArmoryProfile:{}});
  }});
  assert.equal((await call(handler,{action:'refresh',characterName:'테스트',characterId:'c1'})).status,502);assert.equal(writes,0);
});
test('refresh returns only after DB save and never writes raid progress',async()=>{
  let written;
  const handler=createHandler({now:()=>now,apiKey:()=> 'test',fetchImpl:async(url,options)=>{
    if(options.method==='PATCH'){written=JSON.parse(options.body);return response([{...row,...written}]);}
    return response(url.includes('/rest/')?[row]:profile);
  }});
  const result=await call(handler,{action:'refresh',characterName:'테스트',characterId:'c1'});
  assert.equal(result.status,200);assert.equal(written.item_level,1700);assert.equal(written.api_synced_at,new Date(now).toISOString());
  assert.equal('completed_raids' in written,false);assert.deepEqual(result.body.character.completed_raids,['raid1']);
});
test('recent DB timestamp skips armory calls',async()=>{
  let count=0;
  const handler=createHandler({now:()=>now,fetchImpl:async()=>{count++;return response([{...row,api_synced_at:new Date(now-30000).toISOString()}]);}});
  const result=await call(handler,{action:'refresh',characterName:'테스트',characterId:'c1',force:true});
  assert.equal(result.body.cached,true);assert.equal(count,1);
});
test('DB failure is reported instead of claiming refresh success',async()=>{
  const handler=createHandler({apiKey:()=> 'test',fetchImpl:async(url,options)=>{
    if(options.method==='PATCH') return response({},500);
    return response(url.includes('/rest/')?[row]:profile);
  }});
  assert.equal((await call(handler,{action:'refresh',characterName:'테스트',characterId:'c1'})).status,502);
});
test('429 retry is bounded and respects retry-after',async()=>{
  let count=0;const delays=[];
  const handler=createHandler({apiKey:()=> 'test',sleep:async ms=>delays.push(ms),fetchImpl:async()=>{count++;return count===1?response({},429,{'retry-after':'2'}):response(profile);}});
  assert.equal((await call(handler,{characterName:'테스트'})).status,200);assert.equal(count,2);assert.deepEqual(delays,[2000]);
});
test('same-instance requests share the upstream call',async()=>{
  let count=0;
  const handler=createHandler({apiKey:()=> 'test',fetchImpl:async()=>{count++;await new Promise(r=>setTimeout(r,5));return response(profile);}});
  const results=await Promise.all([call(handler,{characterName:'테스트'}),call(handler,{characterName:'테스트'})]);
  assert.equal(count,1);assert.ok(results.every(r=>r.status===200));
});
test('CAS conflict returns latest row without restoring an older profile',async()=>{
  let reads=0;
  const handler=createHandler({apiKey:()=> 'test',fetchImpl:async(url,options)=>{
    if(options.method==='PATCH') return response([]);
    if(url.includes('/rest/')) return response([++reads===1?row:{...row,item_level:1800}]);
    return response(profile);
  }});
  assert.equal((await call(handler,{action:'refresh',characterName:'테스트',characterId:'c1'})).body.character.item_level,1800);
});
