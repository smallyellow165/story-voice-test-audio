import { parseTutorial3D, serializeTutorial3D } from './tutorial.ts'
import type { Tutorial3D } from './tutorial.ts'
export const TUTORIAL_3D_KEY='magnetic-tiles.tutorial3d-draft.v1'
export function loadTutorial3D(storage:Pick<Storage,'getItem'>) {
  const raw=storage.getItem(TUTORIAL_3D_KEY)
  return {raw,tutorial:raw===null?null:parseTutorial3D(raw)}
}
export function saveTutorial3D(storage:Pick<Storage,'getItem'|'setItem'>,t:Tutorial3D,expected:string|null){
  const raw=serializeTutorial3D(t)
  if(storage.getItem(TUTORIAL_3D_KEY)!==expected)throw Error('教程草稿已被其他页面更新；请先导出，再重新加载已保存教程。')
  storage.setItem(TUTORIAL_3D_KEY,raw);return raw
}
