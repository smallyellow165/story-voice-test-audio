import test from 'node:test'
import assert from 'node:assert/strict'
import {STUDIO_MODE_KEY,LEGACY_INTAKE_MODE_KEY,loadStudioMode,saveStudioMode} from '../src/magnetic-tiles/studio-mode.ts'
const storage=(initial={})=>{const data=new Map(Object.entries(initial));return {data,getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)}}
test('Studio mode defaults to 2D and reads the former image-mode preference without rewriting it',()=>{
 const s=storage();assert.equal(loadStudioMode(s).mode,'2d');assert.equal(s.data.size,0)
 s.setItem(LEGACY_INTAKE_MODE_KEY,'visible3d');assert.equal(loadStudioMode(s).mode,'3d');assert.equal(s.getItem(STUDIO_MODE_KEY),null)
 s.setItem(LEGACY_INTAKE_MODE_KEY,'2d');assert.equal(loadStudioMode(s).mode,'2d')
})
test('an explicit global preference is authoritative and only the one preference key is written',()=>{
 const s=storage({[LEGACY_INTAKE_MODE_KEY]:'visible3d','magnetic-tiles.playground.v1':'2d-data','magnetic-tiles.assembly3d-draft.v1':'3d-data'})
 saveStudioMode(s,'2d');assert.equal(loadStudioMode(s).mode,'2d');saveStudioMode(s,'3d');assert.equal(loadStudioMode(s).mode,'3d')
 assert.equal(s.getItem(LEGACY_INTAKE_MODE_KEY),'visible3d');assert.equal(s.getItem('magnetic-tiles.playground.v1'),'2d-data');assert.equal(s.getItem('magnetic-tiles.assembly3d-draft.v1'),'3d-data')
 assert.deepEqual([...s.data.keys()].sort(),[LEGACY_INTAKE_MODE_KEY,'magnetic-tiles.playground.v1','magnetic-tiles.assembly3d-draft.v1',STUDIO_MODE_KEY].sort())
})
test('invalid preferences and storage failures report a warning instead of damaging saved work',()=>{
 const s=storage({[STUDIO_MODE_KEY]:'broken',[LEGACY_INTAKE_MODE_KEY]:'visible3d'}),before=[...s.data]
 assert.equal(loadStudioMode(s).mode,'2d');assert.ok(loadStudioMode(s).warning);assert.deepEqual([...s.data],before)
 assert.ok(loadStudioMode({getItem(){throw Error('denied')}}).warning)
 assert.throws(()=>saveStudioMode({setItem(){throw Error('quota')}},'3d'),/quota/)
 assert.throws(()=>saveStudioMode(s,'invalid'),/无效/)
})
