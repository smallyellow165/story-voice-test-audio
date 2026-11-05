import type {ReactNode} from 'react'
import type {AssemblyOperation} from './ModuleTransformPanel.tsx'

export function AssemblyEditorToolbar({selectionControls,operation,selectOnly,symmetryOpen,disabledReason,transformReason,copyReason,deleteReason,symmetryReason,onSelect,onOperation,onCopy,onDelete,onSymmetry}:{
 selectionControls?:ReactNode
 operation:AssemblyOperation;selectOnly:boolean;symmetryOpen:boolean
 disabledReason:string;transformReason:string;copyReason:string;deleteReason:string;symmetryReason:string
 onSelect:()=>void;onOperation:(op:AssemblyOperation)=>void;onCopy:()=>void;onDelete:()=>void;onSymmetry:()=>void
}){
 const tools=[
  {label:'Select',active:selectOnly&&!symmetryOpen,reason:disabledReason,run:onSelect},
  ...(['move','rotate','orient','snap'] as const).map(op=>({label:{move:'Move',rotate:'Rotate',orient:'Orient',snap:'Snap'}[op],active:!selectOnly&&!symmetryOpen&&operation===op,reason:disabledReason||transformReason,run:()=>onOperation(op)})),
  {label:'Copy',reason:disabledReason||copyReason,run:onCopy},
  {label:'对称补全',active:symmetryOpen,reason:disabledReason||symmetryReason,run:onSymmetry},
  {label:'Delete',reason:disabledReason||deleteReason,run:onDelete},
 ]
 return <div className="assembly-editor-toolbar" role="toolbar" aria-label="3D Editor Toolbar">{selectionControls}{tools.map(t=><span key={t.label} title={t.reason||(t.label==='对称补全'?'Symmetry Fill · 镜像所选来源':t.label)}><button disabled={!!t.reason} aria-pressed={t.active} aria-expanded={t.label==='对称补全'?symmetryOpen:undefined} onClick={t.run}>{t.label}</button></span>)}</div>
}
