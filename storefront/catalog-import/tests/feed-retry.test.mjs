import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchPublic} from '../import.mjs';
const trees='id,title,category,height_cm,price,diameter_cm,branches,offer,discount_pct,photos,active,description\n1,Tree,Green,180,100,90,100,150,-30,,TRUE,Description\n1,Tree,Green,210,0,100,200,0,-30,,FALSE,Description\n';
test('temporary read failures retry once; persistent failures stop after two attempts',async()=>{
  for(const failure of [()=>{throw new DOMException('slow','TimeoutError');},()=>{throw new TypeError('fetch failed');},()=>new Response('unavailable',{status:503})]) {
    let calls=0,delays=[];
    const result=await fetchPublic('trees',{sleep:async ms=>delays.push(ms),fetchImpl:async()=>++calls===1?failure():new Response(trees,{headers:{'content-type':'text/csv'}})});
    assert.equal(result.text,trees);assert.equal(calls,2);assert.deepEqual(delays,[5000]);
    calls=0;
    await assert.rejects(fetchPublic('trees',{sleep:async()=>{},fetchImpl:async()=>{calls++;return failure();}}));
    assert.equal(calls,2);
  }
});
test('invalid CSV and permanent HTTP errors are never retried',async()=>{
  for(const response of [()=>new Response('missing',{status:404}),()=>new Response('invalid',{headers:{'content-type':'text/csv'}})]) {
    let calls=0;
    await assert.rejects(fetchPublic('trees',{sleep:async()=>assert.fail('unexpected retry'),fetchImpl:async()=>{calls++;return response();}}));
    assert.equal(calls,1);
  }
});
