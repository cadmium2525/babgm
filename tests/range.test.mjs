import test from 'node:test';
import assert from 'node:assert/strict';
await import('../dist/range.js');

test('media ranges support Safari probes, open bounds, suffixes and clamping', () => {
  for (const [header, result] of [
    ['bytes=0-1',{start:0,end:1}], ['bytes=2-',{start:2,end:99}],
    ['bytes=-20',{start:80,end:99}], ['bytes=98-500',{start:98,end:99}],
    ['bytes=-500',{start:0,end:99}], ['bytes=0-0',{start:0,end:0}],
    ['bytes=100-',null], ['bytes=8-2',null], ['bytes=-0',null],
    ['bytes=-',null], ['bytes=0-1,3-5',null], ['bytes=NaN-5',null],
    ['bytes=0-999999999999999999999',null]
  ]) assert.deepEqual(parseByteRange(header,100),result,header);
});
test('cached audio returns precise bytes and native media headers', async () => {
  const source=new Response(new Uint8Array([10,20,30,40,50]),{headers:{'Content-Type':'audio/wav'}});
  const partial=await cachedMediaResponse(source.clone(),'bytes=1-3');
  assert.equal(partial.status,206);
  assert.equal(partial.headers.get('Content-Range'),'bytes 1-3/5');
  assert.equal(partial.headers.get('Content-Length'),'3');
  assert.equal(partial.headers.get('Content-Type'),'audio/wav');
  assert.deepEqual([...new Uint8Array(await partial.arrayBuffer())],[20,30,40]);
  const invalid=await cachedMediaResponse(source.clone(),'bytes=5-');
  assert.equal(invalid.status,416);
  assert.equal(invalid.headers.get('Content-Range'),'bytes */5');
  assert.equal((await cachedMediaResponse(source.clone(),null)).status,200);
  assert.equal(source.bodyUsed,false);
});
