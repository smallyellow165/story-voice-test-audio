import { parseTutorial3D, serializeTutorial3D } from './tutorial.ts'
import type { Tutorial3D } from './tutorial.ts'
export const TUTORIAL_3D_KEY='magnetic-tiles.tutorial3d-draft.v1'
type StorageReader=Pick<Storage,'getItem'>
type TutorialWorkspace={schemaVersion:1;current:Tutorial3D;saved:Tutorial3D[]}
function decode(raw:string|null):{tutorial:Tutorial3D|null;saved:Tutorial3D[]}{
  if(raw===null)return {tutorial:null,saved:[]}
  const value=JSON.parse(raw)
  // Legacy Phase 4/5A documents stay readable. Migration happens only on an
  // explicit save/open, in the same key and with the same stale-tab check.
  if(value?.kind==='magnetic-tutorial-3d'){
    const tutorial=parseTutorial3D(raw);return {tutorial,saved:[structuredClone(tutorial)]}
  }
  if(value?.schemaVersion!==1||!Array.isArray(value.saved)||value.saved.length>50||Object.keys(value).some(k=>!['schemaVersion','current','saved'].includes(k)))throw Error('教程工作区格式无效')
  const tutorial=parseTutorial3D(JSON.stringify(value.current)),saved=value.saved.map((t:unknown)=>parseTutorial3D(JSON.stringify(t)))
  if(new Set(saved.map((t:Tutorial3D)=>t.id)).size!==saved.length)throw Error('教程历史 ID 重复')
  return {tutorial,saved}
}
export function loadTutorial3D(storage:StorageReader){
  const raw=storage.getItem(TUTORIAL_3D_KEY)
  return {raw,...decode(raw)}
}
function persist(storage:StorageReader&Pick<Storage,'setItem'>,value:TutorialWorkspace,expected:string|null){
  if(storage.getItem(TUTORIAL_3D_KEY)!==expected)throw Error('教程草稿已被其他页面更新；请先导出，再重新加载已保存教程。')
  const raw=JSON.stringify(value);storage.setItem(TUTORIAL_3D_KEY,raw);return raw
}
export function saveTutorial3D(storage:StorageReader&Pick<Storage,'setItem'>,t:Tutorial3D,expected:string|null){
  const tutorial=parseTutorial3D(serializeTutorial3D(t)),previous=decode(expected)
  const saved=[tutorial,...previous.saved.filter(s=>s.id!==tutorial.id)]
  if(saved.length>50)throw Error('最多保存 50 个教程，请先导出备份。现有教程未覆盖。')
  return persist(storage,{schemaVersion:1,current:tutorial,saved},expected)
}
export function openSavedTutorial3D(storage:StorageReader&Pick<Storage,'setItem'>,id:string,expected:string|null){
  const previous=decode(expected),tutorial=previous.saved.find(t=>t.id===id)
  if(!tutorial)throw Error('所选教程不存在，当前教程保留。')
  const raw=persist(storage,{schemaVersion:1,current:tutorial,saved:previous.saved},expected)
  return {raw,tutorial:structuredClone(tutorial),saved:previous.saved}
}
