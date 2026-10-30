import { profiles, profileKey } from './profiles.ts'
import { readStudioUrl, workflowStages } from './studio-url.ts'
import type { WorkflowStage } from './studio-url.ts'
export const PANEL_PREFERENCES_KEY='magnetic-studio.right-panel.v1'
export type RightTab='inspector'|'catalog'
export type PanelPreferences={rightTab:RightTab;catalogProfile:string;lastStage:WorkflowStage}
export function resolvePanelState(href:string,saved:unknown,catalog:readonly import('./geometry.ts').Profile[]=profiles){
 const previous=(saved&&typeof saved==='object'?saved:{}) as Partial<PanelPreferences>,params=new URL(href).searchParams,{values}=readStudioUrl(href),warnings:string[]=[]
 const legacy=params.get('stage')==='catalog'
 const hasContext=['sourceId','analysisId','reviewId','reconstructionId','candidateId','assemblyId','buildId','observationId'].some(key=>values[key])
 const stage=(legacy&&!hasContext&&workflowStages.includes(previous.lastStage!)?previous.lastStage:values.stage||'assembly') as WorkflowStage
 const wantedTab=legacy?'catalog':params.has('rightTab')?params.get('rightTab'):previous.rightTab||'inspector'
 const rightTab:RightTab=wantedTab==='catalog'?'catalog':'inspector'
 if(!['catalog','inspector'].includes(String(wantedTab)))warnings.push('rightTab 无效，当前显示 Inspector；工作上下文保持不变。')
 const wantedProfile=params.has('catalogProfile')?params.get('catalogProfile'):previous.catalogProfile||profileKey(catalog[0])
 const catalogProfile=catalog.some(p=>profileKey(p)===wantedProfile)?wantedProfile as string:profileKey(catalog[0])
 if(catalogProfile!==wantedProfile)warnings.push(`Catalog Profile 不可用，当前显示 ${catalogProfile}；没有修改任何零件 Profile。`)
 return {stage,rightTab,catalogProfile,legacy,warnings}
}
