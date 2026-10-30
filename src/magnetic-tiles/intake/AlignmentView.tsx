import {intersectionPolygon,polygonArea} from './segment-audit.ts'
import {useMemo,useState} from 'react'
import {AssemblyPreview} from '../AssemblyPreview.tsx'
import {vertices,edges,validate,edgeContact,connectionSegment} from '../geometry.ts'
import type {Vec} from '../geometry.ts'
import type {Reconstruction} from './contracts.ts'
import type {DiagnosticCandidate} from './execution-trace.ts'
import {alignmentInspection,contourResidual} from './alignment-inspection.ts'
export function AlignmentView({record,diagnostic,selected,onSelect}:{record:Reconstruction;diagnostic:DiagnosticCandidate;selected:string;onSelect:(id:string)=>void}){
 const [overlay,setOverlay]=useState(false),[choice,setChoice]=useState('saved')
 const data=useMemo(()=>overlay?alignmentInspection(record,diagnostic.id):null,[overlay,record,diagnostic.id])
 const defaultView=record.trace?<AssemblyPreview assembly={{schemaVersion:2,mode:'flat-mosaic',id:record.id,revision:0,name:'Diagnostic only',instances:diagnostic.tiles}} profiles={record.trace.input.profiles} selected={selected} onSelect={onSelect} label="Diagnostic 几何摆放"/>:<p>该历史记录缺少执行 Profile 快照，无法显示诊断几何。</p>
 if(!overlay)return <><button className="alignment-toggle" disabled={!record.trace||!diagnostic.attemptedConnection} onClick={()=>setOverlay(true)}>对齐 / 镜像叠加</button>{defaultView}</>
 if(!data?.available)return <><button onClick={()=>setOverlay(false)}>返回实际布局</button><p>{data?.reason}</p>{defaultView}</>
 const alternative=data.alternatives.find(a=>a.id===choice),joint=choice.startsWith('joint-')?data.freePair.poses[Number(choice.slice(6))]:undefined
 const independent=choice==='independent',independentFit=data.independent.rigid.residual.rms<=data.independent.mirrored.residual.rms?data.independent.rigid:data.independent.mirrored
 const tile=joint?.tiles[0]??(independent?independentFit.tile:alternative?.tile??data.actual.tile),target=joint?.tiles[1]??data.actual.target
 const residual=contourResidual(tile,data.observed.from,data.catalog),targetResidual=contourResidual(target,data.observed.to,data.catalog)
 const layout=diagnostic.tiles.map(t=>t.id===tile.id?tile:t.id===target.id?target:t),pair=validate([tile,target],data.catalog),context=validate(layout,data.catalog)
 const points=[...data.observed.from,...data.observed.to,...vertices(data.actual.tile,data.catalog),...vertices(tile,data.catalog),...vertices(target,data.catalog)],xs=points.map(p=>p[0]),ys=points.map(p=>-p[1]),box=`${Math.min(...xs)-.2} ${Math.min(...ys)-.2} ${Math.max(...xs)-Math.min(...xs)+.4} ${Math.max(...ys)-Math.min(...ys)+.4}`
 const pts=(vs:Vec[])=>vs.map(([x,y])=>[x,-y].join(',')).join(' '),targetEdge=edges(target,data.catalog).find(e=>e.id===(joint?.targetEdgeId??alternative?.targetEdgeId??data.actual.connection.targetEdgeId))!,ownEdge=edges(tile,data.catalog).find(e=>e.id===(joint?.ownEdgeId??alternative?.ownEdgeId??data.actual.connection.ownEdgeId))!
 const contact=edgeContact(ownEdge,targetEdge),audit=record.trace?.search.connectivityAudit
 const overlaps=context.issues.filter(i=>i.code==='OVERLAP'&&(i.tileIds.includes(tile.id)||i.tileIds.includes(target.id))).map(i=>{const polygon=intersectionPolygon(vertices(layout.find(t=>t.id===i.tileIds[0])!,data.catalog),vertices(layout.find(t=>t.id===i.tileIds[1])!,data.catalog));return {ids:i.tileIds,polygon,area:polygonArea(polygon)}})
 return <div className="alignment-inspection">
  <div className="button-row"><button onClick={()=>setOverlay(false)}>返回实际布局</button><select aria-label="对齐比较方案" value={choice} onChange={e=>setChoice(e.target.value)}>
   <option value="saved">已保存实际尝试 · RMS {data.actual.residual.rms.toFixed(6)}</option>
   {data.alternatives.map(a=><option key={a.id} value={a.id}>{a.id.startsWith('segment-')?'分段 ':'整边 '}{a.mirrored?'镜像':'非镜像'} {a.ownEdgeId} → {a.targetEdgeId} · RMS {a.residual.rms.toFixed(6)}</option>)}
   {record.mode!=='flat-mosaic'&&<><option value="independent">原图独立拟合（未约束连接）· RMS {independentFit.residual.rms.toFixed(6)}</option>{data.freePair.poses.map((p,i)=><option key={'joint-'+i} value={'joint-'+i}>旧整边双方自由拟合 {p.ownEdgeId} → {p.targetEdgeId} · 联合 RMS {p.jointRms.toFixed(6)}</option>)}</>}
  </select></div>
  <p>{record.mode==='flat-mosaic'?'灰虚线：Review；红虚线：历史 '+tile.id+'；绿：固定 '+target.id+'；蓝：当前对比；橙线：顶点偏差。仅聚焦这两个零件。':<>灰虚线：Review；红虚线：历史 {tile.id}；绿：{target.id}{joint?'（自由拟合）':'（固定）'}；蓝：对比 {tile.id}；橙线：顶点偏差。其余零件保持历史 Pose。</>}</p>
  <svg className="intake-candidate alignment-overlay" viewBox={box} aria-label="边对齐镜像诊断叠加" role="img">
   {record.mode!=='flat-mosaic'&&layout.filter(t=>t.id!==tile.id&&t.id!==target.id).map(t=><polygon key={t.id} data-alignment-context={t.id} points={pts(vertices(t,data.catalog))} fill={t.color+'22'} stroke="#a2aaa7" strokeWidth="1" vectorEffect="non-scaling-stroke"/>)}
   {[data.observed.from,data.observed.to].map((v,i)=><polygon key={i} points={pts(v)} fill="none" stroke="#777" strokeWidth="2" strokeDasharray="5 4" vectorEffect="non-scaling-stroke"/>)}
   <polygon data-alignment-target-pose={JSON.stringify(target.pose)} points={pts(vertices(target,data.catalog))} fill="#31986c22" stroke="#21865e" strokeWidth="2" vectorEffect="non-scaling-stroke"/>
   <polygon points={pts(vertices(data.actual.tile,data.catalog))} fill="none" stroke="#cc4651" strokeWidth="2" strokeDasharray="7 3" vectorEffect="non-scaling-stroke"/>
   <polygon data-alignment-pose={JSON.stringify(tile.pose)} points={pts(vertices(tile,data.catalog))} fill="#276fc022" stroke="#276fc0" strokeWidth="2" vectorEffect="non-scaling-stroke"/>
   {overlaps.map((o,i)=><polygon key={'area-'+i} data-overlap-area={o.area} points={pts(o.polygon)} fill="#de333355" stroke="#c42e2e" strokeWidth="1" vectorEffect="non-scaling-stroke"/>)}
   {residual.pairs.map(p=><g key={p.profileVertex}><line x1={p.world[0]} y1={-p.world[1]} x2={p.observed[0]} y2={-p.observed[1]} stroke="#c88b22" vectorEffect="non-scaling-stroke"/><circle cx={p.world[0]} cy={-p.world[1]} r=".025" fill="#276fc0"/><text x={p.world[0]+.03} y={-p.world[1]} fontSize=".09">v{p.profileVertex}</text></g>)}
   {!independent&&[targetEdge,ownEdge].map((e,i)=><g key={i}><line data-alignment-edge={i?'own':'target'} x1={e.a[0]} y1={-e.a[1]} x2={e.b[0]} y2={-e.b[1]} stroke={i?'#7542bd':'#d48b13'} strokeWidth={i?2:5} vectorEffect="non-scaling-stroke"/><text x={(e.a[0]+e.b[0])/2} y={-(e.a[1]+e.b[1])/2+(i ? .1 : -.04)} fontSize=".09">{e.tileId}.{e.id}</text></g>)}
   {!independent&&context.connections.filter(c=>c.a.tileId===tile.id||c.b.tileId===tile.id).map((c,i)=>{const span=connectionSegment(c,layout,data.catalog),other=c.a.tileId===tile.id?c.b:c.a;return <g key={'span-'+i}><line data-alignment-span={JSON.stringify(c)} x1={span.start[0]} y1={-span.start[1]} x2={span.end[0]} y2={-span.end[1]} stroke={i%2?'#df8518':'#06a178'} strokeWidth="5" vectorEffect="non-scaling-stroke"/><text x={(span.start[0]+span.end[0])/2} y={-(span.start[1]+span.end[1])/2+.08*(i+1)} fontSize=".08">{other.tileId}.{other.edgeId} · {span.length.toFixed(3)}</text></g>})}
   {!independent&&contact&&<line data-alignment-contact={JSON.stringify(contact)} x1={contact.start[0]} y1={-contact.start[1]} x2={contact.end[0]} y2={-contact.end[1]} stroke="#06a178" strokeWidth="6" vectorEffect="non-scaling-stroke"/>}
  </svg>
  <p data-testid="alignment-summary">{choice==='saved'?'已保存真实尝试':'计算反事实，非历史搜索尝试'} · RMS {residual.rms.toFixed(9)} / {data.threshold.toFixed(3)} · pair valid {String(pair.valid)} · context valid {String(context.valid)} · 镜像 {String(!!tile.pose.mirrored)}{!independent&&contact?` · 接触段 ${contact.length.toFixed(6)} · own [${contact.aRange.map(n=>n.toFixed(4)).join(", ")}]`:""}{joint?` · ${target.id} 镜像 ${!!target.pose.mirrored} · ${target.id} RMS ${targetResidual.rms.toFixed(9)} · 联合 RMS ${joint.jointRms.toFixed(9)}`:independent?' · 未施加整边连接':''}</p>
  {overlaps.length>0&&<p data-testid="alignment-overlap-areas">面积重叠（标准单位²）：{overlaps.map(o=>o.ids.join('/')+' '+o.area.toFixed(6)).join('；')}</p>}
  {context.issues.length>0&&<p data-testid="alignment-rejections">{context.issues.map(i=>i.code+' '+i.tileIds.join('/')).join('；')}</p>}
  {audit&&<details data-testid="connectivity-audit"><summary>Connected 连接轮廓诊断 · 旧等长整边规则 · {audit.incompatible?'不相容':'必要条件未排除'}{audit.isolatedIds.length?' · '+audit.isolatedIds.join('/')+' 无可行连接邻居':''}</summary><p>双方均可自由移动和旋转，枚举等长边与镜像后，联合 RMS 下界仍须 ≤ {audit.threshold.toFixed(3)}。只对旧整边规则成立，不能排除当前分段连接。不能把未排除的边当成有效连接。</p><pre>{JSON.stringify(audit,null,2)}</pre></details>}
  <p className="hint">历史执行规则：{record.trace?.search.parameters.connectionModel??'whole-edge-v1'}；当前复核：segmented-edge-v1。保存的历史 Validator 原文见 Inspector / Trace。</p>{record.trace?.search.segmentAudit&&<details><summary>分段连接 / 面积重叠输入证据</summary><pre>{JSON.stringify(record.trace.search.segmentAudit,null,2)}</pre></details>}
  <table><thead><tr><th>Profile / Review 顶点</th><th>ΔX</th><th>ΔY</th><th>距离</th></tr></thead><tbody>{residual.pairs.map(p=><tr key={p.profileVertex}><td>v{p.profileVertex} / o{p.observationVertex}</td><td>{p.delta[0].toFixed(6)}</td><td>{p.delta[1].toFixed(6)}</td><td>{p.distance.toFixed(6)}</td></tr>)}</tbody></table>
  <details><summary>对比 Trace / 端点 / Validator JSON</summary><pre>{JSON.stringify({...data,selectedComparison:{choice,tiles:[tile,target],residual,targetResidual,pairValidator:pair,contextValidator:context}},null,2)}</pre></details>
 </div>
}
