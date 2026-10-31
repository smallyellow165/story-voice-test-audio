export type StudioMode='2d'|'3d'
export const STUDIO_MODE_KEY='magnetic-studio.mode.v1'
export const LEGACY_INTAKE_MODE_KEY='magnetic-visible3d-mode'
export function loadStudioMode(storage:Pick<Storage,'getItem'>):{mode:StudioMode;warning:string}{
  try{
    const saved=storage.getItem(STUDIO_MODE_KEY)
    if(saved==='2d'||saved==='3d')return {mode:saved,warning:''}
    if(saved!==null)return {mode:'2d',warning:'保存的 Studio 模式无效，当前显示 2D；工作数据未修改。'}
    // The previous preference only covered image stages. Use it once as a
    // fallback; it is no longer a separately writable mode source.
    return {mode:storage.getItem(LEGACY_INTAKE_MODE_KEY)==='visible3d'?'3d':'2d',warning:''}
  }catch{return {mode:'2d',warning:'无法读取 Studio 模式，当前显示 2D；工作数据未修改。'}}
}
export function saveStudioMode(storage:Pick<Storage,'setItem'>,mode:StudioMode){
  if(mode!=='2d'&&mode!=='3d')throw Error('Studio 模式无效')
  storage.setItem(STUDIO_MODE_KEY,mode)
}
