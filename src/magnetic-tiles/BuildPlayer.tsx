import { StudioSlot } from './StudioLayout.tsx'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { contacts } from './build-plan.ts'
import type { BuildBundle, BuildProgress } from './build-plan.ts'
import { edges, profileFor, validate, vertices } from './geometry.ts'
import type { Profile } from './geometry.ts'
const colorNames: Record<string, string> = { '#f5b942': '黄色', '#ef795d': '珊瑚红', '#55b8ac': '青绿色', '#7e9bda': '蓝色', '#b895cf': '紫色' }
export function BuildPlayer({ bundle, progress, profiles, disabled, onProgress, footer, sourceInfo }: { bundle: BuildBundle; progress: BuildProgress; profiles: readonly Profile[]; disabled: boolean; onProgress: (p: BuildProgress) => void; footer?:ReactNode; sourceInfo?:ReactNode }) {
  const [replay, setReplay] = useState(0),instruction=useRef<HTMLDivElement>(null)
  useEffect(()=>{if(instruction.current)instruction.current.scrollTop=0},[progress.step,progress.completed,replay])
  const { plan, snapshot } = bundle, assembly = snapshot.assembly
  const step = plan.steps[progress.step], tile = assembly.instances.find(t => t.id === step.addInstanceId)!
  const placed = new Set(plan.steps.slice(0, progress.step).map(s => s.addInstanceId))
  const visible = assembly.instances.filter(t => placed.has(t.id) || t.id === tile.id)
  const connections = contacts(tile.id, placed, validate(assembly.instances, profiles).connections)
  const points = assembly.instances.flatMap(t => vertices(t, profiles)), xs = points.map(p => p[0]), ys = points.map(p => -p[1])
  const viewBox = `${Math.min(...xs) - .5} ${Math.min(...ys) - .5} ${Math.max(...xs) - Math.min(...xs) + 1} ${Math.max(...ys) - Math.min(...ys) + 1}`
  const colorName = colorNames[tile.color.toLowerCase()] ?? '图示颜色'
  const move = (index: number, completed = false) => onProgress({ ...progress, step: index, completed })
  return <><StudioSlot column="workspace" stages={['build']}><section className="build-player" aria-label="搭建教程播放器">
    <h3>教程播放 · {plan.title} · {progress.completed ? '已完成！' : `第 ${progress.step + 1} / ${plan.steps.length} 步`}</h3>
    <svg className="build-board" viewBox={viewBox} role="img" aria-label={`搭建教程，第 ${progress.step + 1} 步`}>
      <g transform="scale(1 -1)">{step.startsComponent && assembly.instances.filter(t=>!placed.has(t.id)&&t.id!==tile.id).map(t=><polygon key={"guide-"+t.id} points={vertices(t,profiles).map(v=>v.join(",")).join(" ")} fill="none" stroke="#829994" strokeWidth=".015" strokeDasharray=".06 .05"/>)}{visible.map(t => <polygon key={t.id === tile.id ? `${t.id}-${replay}` : t.id} data-build-tile={t.id} className={t.id === tile.id ? 'build-tile current' : 'build-tile'} points={vertices(t, profiles).map(v => v.join(',')).join(' ')} fill={t.color}/>)}
      {connections.map(c => { const edge = edges(assembly.instances.find(t => t.id === c.targetInstanceId)!, profiles).find(e => e.id === c.targetEdgeId)!; const range=c.contact?.targetRange??[0,1],delta=[edge.b[0]-edge.a[0],edge.b[1]-edge.a[1]],a=[edge.a[0]+delta[0]*range[0],edge.a[1]+delta[1]*range[0]],b=[edge.a[0]+delta[0]*range[1],edge.a[1]+delta[1]*range[1]];return <line data-build-contact={c.contact?JSON.stringify(c.contact):undefined} key={`${c.targetInstanceId}-${c.targetEdgeId}`} className="build-edge" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]}/> })}</g>
      {visible.map(t => { const vs = vertices(t, profiles), x = vs.reduce((s, v) => s + v[0], 0) / vs.length, y = -vs.reduce((s, v) => s + v[1], 0) / vs.length; return <g key={t.id} aria-hidden="true"><circle cx={x} cy={y} r=".14" fill="#fffdf7"/><text x={x} y={y} textAnchor="middle" dominantBaseline="central" fontSize=".2" fill="#243e3a">{plan.steps.findIndex(s => s.addInstanceId === t.id) + 1}</text></g> })}
    </svg>
    </section></StudioSlot><StudioSlot column="inspector" stages={['build']}><section className="build-playback-controls" aria-label="搭建步骤与保存">{sourceInfo}<div className="build-step-heading" aria-live="polite">{progress.completed?'本次播放已完成':`第 ${progress.step+1} / ${plan.steps.length} 步`}</div><div ref={instruction} className="build-instruction" tabIndex={0} aria-live="polite"><p><span className="build-color" style={{ backgroundColor: tile.color }} aria-label={colorName}/><b>{profileFor(tile, profiles)!.name}</b> · {colorName}</p><p>{progress.completed ? '你完成了整个作品！可以重新开始，再搭一次。' : step.instruction}</p><p className="hint">{step.startsComponent ? "这是新组件的第一块，按全图位置独立摆放；浅色轮廓提示最终位置。" : "粗边框是这一步的新磁力片；虚线标出需要接上的边"}{connections.length > 1 ? `（本步同时接上 ${connections.length} 条边）` : ''}。</p></div>
    <div className="build-transport" aria-label="步骤播放控制"><button disabled={disabled || progress.step === 0} onClick={() => move(progress.step - 1)}>上一步</button><button className="primary" disabled={disabled || progress.completed} onClick={() => move(progress.step < plan.steps.length-1?progress.step+1:progress.step,progress.step===plan.steps.length-1)}>{progress.step < plan.steps.length-1?'下一步':'完成搭建'}</button><button disabled={disabled} onClick={() => setReplay(r => r + 1)}>重播当前步</button><button disabled={disabled} onClick={() => { setReplay(r => r + 1); move(0) }}>重新开始</button></div>
    {footer}</section></StudioSlot></>
}
