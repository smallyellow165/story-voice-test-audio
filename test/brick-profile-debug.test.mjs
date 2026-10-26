import test from 'node:test'
import assert from 'node:assert/strict'
import {brickLibraryPlugin} from '../server/brick-library.mjs'
import {loadBrickRules} from '../server/brick-rules.mjs'
const rules=await loadBrickRules()
test('debug coordinates are the original arrays; penguin 0→4 etc. align after original relative placement',()=>{
 const a=rules.geometrySupport('3437').geometry,b=rules.geometrySupport('40666').geometry
 assert.deepEqual(a.bottom.map(p=>[p.x,p.y,p.z]),[[-20,0,-20],[-20,0,20],[20,0,-20],[20,0,20]])
 assert.deepEqual(a.top.map(p=>[p.x,p.y,p.z]),a.bottom.map(p=>[p.x,48,p.z]))
 assert.deepEqual(b.top.map(p=>[p.x,p.y,p.z]),[-60,-20,20,60].flatMap(x=>[-20,20].map(z=>[x,24,z])))
 for(let i=0;i<4;i++)assert.deepEqual([a.bottom[i].x,a.bottom[i].y+24,a.bottom[i].z],[b.top[i+4].x-40,b.top[i+4].y,b.top[i+4].z])
})
test('read-only debug metadata inspects actual unsupported DAT without manufacturing a Profile',async()=>{
 const plugin=brickLibraryPlugin();plugin.configResolved({base:'/test/'});let handler;plugin.configureServer({middlewares:{use(fn){handler=fn}}})
 async function request(url,method='GET'){let status,value;await handler({url,method},{writeHead(s){status=s;return this},end(body){value=JSON.parse(body)}},()=>{throw Error('unexpected route')});return {status,value}}
 const r=await request('/test/brick-profile?part=98223b');assert.equal(r.status,200);assert.equal(r.value.inspection.available,true);assert.equal(rules.geometrySupport(r.value.part).supported,false)
 assert.equal((await request('/test/brick-profile?part=3437','POST')).status,405)
 assert.equal((await request('/test/brick-profile?part=../3437')).status,400)
 assert.equal((await request('/test/brick-profile?part=3437&kind=guess')).status,400)
})
