import type { WorkflowStage } from './studio-url.ts'
// Presentation vocabulary only. Stage IDs, work-mode enums and snapshots do not change.
export const workflowTerms:Record<WorkflowStage,{label:string;hint:string}>={
 source:{label:'图片与识别（Analysis）',hint:'图片来源 · 模型选择 · 执行识别'},
 review:{label:'识别审核（Review）',hint:'零件确认 · Profile Matching · 保存审核快照'},
 reconstruction:{label:'几何重建（Reconstruction）',hint:'选择 Review · 配置模式 · 生成 Candidate'},
 assembly:{label:'作品编辑（Assembly）',hint:'自由编辑 · 保存作品快照'},
 build:{label:'搭建教程（Build）',hint:'选择作品 · 生成教程 · 播放步骤'},
}
export const reconstructionAction='生成几何重建'
export const workModeNames={
 'connected-construction':'整体连通（Connected Construction）',
 'flat-mosaic':'平面拼图（Flat Mosaic）',
} as const
