import test from 'node:test'
import assert from 'node:assert/strict'
import {assemblySaveStatus,sameAssemblyContents} from '../src/magnetic-tiles/assembly-source.ts'
const a={schemaVersion:1,id:'source',revision:2,name:'作品',instances:[{id:'one',profileId:'square',profileVersion:1,color:'#ff0000',pose:{x:0,y:0,angleRad:0}}]}
test('source save status compares editable content, not load-induced revision',()=>{
 assert.match(assemblySaveStatus(a,[]),/未保存草稿/)
 assert.match(assemblySaveStatus({...a,revision:99},[a]),/一致/)
 for(const mutate of [v=>v.name='新名字',v=>v.instances[0].color='#00ff00',v=>v.instances[0].pose.x=1,v=>v.instances=[],v=>{v.schemaVersion=2;v.mode='flat-mosaic'}]){
  const b=structuredClone(a);mutate(b);assert.equal(sameAssemblyContents(a,b),false);assert.match(assemblySaveStatus(b,[a]),/未保存草稿.*不同/)
 }
 assert.match(assemblySaveStatus({...a,id:'other'},[a]),/尚无/)
})
