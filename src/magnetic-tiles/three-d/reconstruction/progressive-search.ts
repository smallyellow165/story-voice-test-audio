import {Quaternion,Vector3} from 'three'
import type {Assembly3D,Piece3D} from '../assembly.ts'
import {fromEnginePose,toEnginePose} from '../assembly.ts'
import {createShapeCatalog,profileKey3D} from '../profile-adapter.ts'
import {solveAssembly3D,validateAssembly3D,assemblyValidationLayers,inspectAssemblyCollisions} from '../engine-adapter.ts'
import {computeTransformFromConnection,computeAllConnectionResiduals} from '../vendor/engine/solver.ts'
import {inspectPortCompatibility} from '../vendor/engine/port-compatibility.ts'
import type {Connection} from '../vendor/engine/types.ts'
import {parseSpatialHypothesis,validateVisibleInput} from './contracts.ts'
import type {ConnectionHypothesis3D,SpatialHypothesis3D,VisibleInput3D} from './contracts.ts'
import {candidateObservationMap,inspectSpatialConsistency} from './spatial-consistency.ts'
import type {VisibleCandidate3D,VisibleExecution3D,VisibleExecutionOptions} from './execute.ts'

export type ProgressiveStatistics={
    scope:'bounded-progressive-connected-subgraphs';termination:string;nodes:number;maxNodes:number;
    checks:{nominal:number;seed:number;recovery:number;growth:number};cacheHits:number;deduplicated:number;
    portPruned:number;proofPruned:number;beamPruned:number;beamWidth:number;nominalGraphs:number;
    acceptedStates:number;growthExpansions:number;reusedPosePieces:number;
    maxConnected:number;verifiedConnectedUnion:string[];returnedUnion:string[];standaloneVerified:string[];unplaced:string[];
    independentComponentCoverage:string[];componentResults:{observations:string[];best:string[];connections:number}[];
    graphComponents:string[][];failureCounts:Record<string,number>;
}
type Report=ReturnType<typeof validateAssembly3D>
type Context={variantIndex:number;label:string;hypotheses:ConnectionHypothesis3D[];component:string[]}
type State={assembly:Assembly3D;geometry:Report;context:Context;path:string[]}
type Recovery={parent:State;ids:string[]}
type Growth={state:State;choices:Connection[];cursor:number;component:string}
const pair=(c:{pieceA:string;pieceB:string})=>[c.pieceA,c.pieceB].sort().join('|')
const has=(a:Assembly3D,id:string)=>a.pieces.some(p=>p.id===id)
const domain=(c:ConnectionHypothesis3D):Connection[]=>!c.portA||!c.portB||c.intent==='separate'?[]:[...new Set([...c.angles,...(c.angleRange?[c.angleRange.min,(c.angleRange.min+c.angleRange.max)/2,c.angleRange.max]:[])])].flatMap(dihedralDeg=>(c.flip===null?[false,true]:[c.flip]).map(flip=>({pieceA:c.pieceA,pieceB:c.pieceB,portA:c.portA!,portB:c.portB!,dihedralDeg,flip})))
function components(ids:string[],cs:{pieceA:string;pieceB:string}[]):string[][]{
    const pending=new Set(ids),out:string[][]=[]
    while(pending.size){const group=[pending.values().next().value!];pending.delete(group[0]);for(let i=0;i<group.length;i++)for(const c of cs){const next=c.pieceA===group[i]?c.pieceB:c.pieceB===group[i]?c.pieceA:null;if(next&&pending.delete(next))group.push(next)}out.push(group.sort())}return out
}
function ordered(a:Assembly3D):Assembly3D{return {...a,pieces:[...a.pieces].sort((a,b)=>a.id.localeCompare(b.id)),connections:[...a.connections].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))}}
/** Rigid normalization is for deduplication only. Stored and validated poses stay exact. */
function stateKey(a:Assembly3D){
    const root=[...a.pieces].sort((a,b)=>a.id.localeCompare(b.id))[0],q=new Quaternion(...root.pose.quaternion).invert(),p=new Vector3(...root.pose.position)
    return JSON.stringify({pieces:[...a.pieces].sort((a,b)=>a.id.localeCompare(b.id)).map(x=>{const position=new Vector3(...x.pose.position).sub(p).applyQuaternion(q),rotation=q.clone().multiply(new Quaternion(...x.pose.quaternion));const sign=rotation.toArray().findLast(n=>Math.abs(n)>1e-10)!<0?-1:1;return [x.id,x.profileId,x.profileVersion,position.toArray().map(n=>Math.round(n*1e8)),rotation.toArray().map(n=>Math.round(n*sign*1e8))]}),connections:a.connections})
}
/** Attach exactly one new piece using the existing signed hinge primitive.
 * Every existing pose and connection is copied byte-for-byte, never re-solved. */
export function attachProgressivePiece(a:Assembly3D,piece:Piece3D,c:Connection):Assembly3D{
    if(has(a,piece.id)||!has(a,c.pieceA)&&!has(a,c.pieceB))throw Error('Progressive attachment requires one existing endpoint and one new piece')
    const baseId=has(a,c.pieceA)?c.pieceA:c.pieceB,isA=baseId===c.pieceA,base=a.pieces.find(p=>p.id===baseId)!,catalog=createShapeCatalog(a.profiles)
    if((isA?c.pieceB:c.pieceA)!==piece.id)throw Error('Attachment endpoint identity mismatch')
    const baseShape=catalog.get(profileKey3D({id:base.profileId,version:base.profileVersion}))!.shape,shape=catalog.get(profileKey3D({id:piece.profileId,version:piece.profileVersion}))!.shape
    const pose=computeTransformFromConnection(toEnginePose(base.pose),baseShape,isA?c.portA:c.portB,shape,isA?c.portB:c.portA,isA||c.flip?c.dihedralDeg:-c.dihedralDeg,c.flip??false)
    if(!pose)throw Error('Cannot compute progressive hinge pose')
    return {...structuredClone(a),pieces:[...structuredClone(a.pieces),{...structuredClone(piece),pose:fromEnginePose(pose)}],connections:[...structuredClone(a.connections),structuredClone(c)]}
}
/** V5 is a bounded anytime search. Keep this implementation versioned for exact
 * immutable Execution replay. It does not claim exhaustive angle/pose search. */
export function executeProgressive(planValue:SpatialHypothesis3D,inputValue:VisibleInput3D,options:VisibleExecutionOptions):VisibleExecution3D{
    const input=validateVisibleInput(inputValue),plan=parseSpatialHypothesis(planValue,input)
    const maxChecks=options.maxGeometryChecks??256,maxGraphs=options.maxAssignments??128,maxNodes=options.maxLocalSubsets??1024,beamWidth=options.maxLocalParents??32,topK=options.topK??5,maxDiagnostics=options.maxDiagnosticCandidates??8
    for(const [n,min,max] of [[maxChecks,0,4096],[maxGraphs,0,2048],[maxNodes,0,8192],[beamWidth,1,64],[topK,1,20],[maxDiagnostics,1,20]])if(!Number.isSafeInteger(n)||n<min||n>max)throw Error('Progressive 搜索预算无效')
    const confirmed=input.review.pieces.filter(p=>p.confirmed&&!p.excluded),known=confirmed.filter(p=>p.profileId),excluded=input.review.pieces.filter(p=>p.excluded).map(p=>p.id)
    const catalog=createShapeCatalog(input.profiles),piece=(id:string):Piece3D=>{const p=known.find(p=>p.id===id)!;return {id,profileId:p.profileId!,profileVersion:p.profileVersion!,color:p.color,pose:{position:[0,0,0],quaternion:[0,0,0,1]}}}
    const shape=(a:Assembly3D,id:string)=>{const p=a.pieces.find(p=>p.id===id)!;return catalog.get(profileKey3D({id:p.profileId,version:p.profileVersion}))!.shape}
    const portCompatibility=(a:Assembly3D)=>inspectPortCompatibility(a.connections,id=>shape(a,id),Object.fromEntries(a.pieces.map(p=>[p.id,toEnginePose(p.pose)])))
    const assembly=(ids:string[],cs:Connection[]):Assembly3D=>({kind:'magnetic-assembly-3d',schemaVersion:1,id:'visible-candidate',revision:0,profiles:structuredClone(input.profiles),pieces:ids.map(piece),connections:structuredClone(cs)})
    const overrides=input.review.constraints,overridden=new Set(overrides.map(pair)),variants=[{label:'primary',connections:plan.connections},...plan.alternatives].map(v=>({...v,connections:[...v.connections.filter(c=>!overridden.has(pair(c))),...overrides]}))
    const stats:ProgressiveStatistics={scope:'bounded-progressive-connected-subgraphs',termination:'frontier-exhausted',nodes:0,maxNodes,checks:{nominal:0,seed:0,recovery:0,growth:0},cacheHits:0,deduplicated:0,portPruned:0,proofPruned:0,beamPruned:0,beamWidth,nominalGraphs:0,acceptedStates:0,growthExpansions:0,reusedPosePieces:0,maxConnected:0,verifiedConnectedUnion:[],returnedUnion:[],standaloneVerified:[],unplaced:[],independentComponentCoverage:[],componentResults:[],graphComponents:components(known.map(p=>p.id),variants.flatMap(v=>v.connections.filter(c=>domain(c).length))),failureCounts:{}}
    const diagnostics=new Set<string>(),valid=new Map<string,State>(),failed=new Map<string,State>(),reports=new Map<string,Report>(),seen=new Set<string>(),recoveries:Recovery[]=[],recoveryKeys=new Set<string>(),growth:Growth[]=[],growthKeys=new Set<string>()
    let checks=0,round=0,componentTurn=0,nominalTruncated=false
    if(!known.length)diagnostics.add('NO_REVIEWED_PROFILE: 没有具有准确 Profile 的已确认实例')
    const unknownConnections=variants.flatMap(v=>v.connections).filter(c=>c.intent!=='separate'&&!domain(c).length)
    if(unknownConnections.length)diagnostics.add(`UNKNOWN_CONSTRAINTS: ${unknownConnections.length} 条假设缺少可执行 Port / 角度；保留来源，不猜测连接或位置。`)

    const hard=(ctx:Context)=>ctx.hypotheses.filter(c=>c.intent==='connect'&&(options.protectPlanConnections||overrides.some(h=>pair(h)===pair(c))||(input.review.spatialChecks??[]).some(s=>s.relation==='shared-edge'&&pair(s)===pair(c))))
    function eligible(s:State){return hard(s.context).every(h=>s.assembly.connections.some(c=>pair(c)===pair(h)))&&(input.review.spatialChecks??[]).filter(c=>c.relation==='shared-edge'||c.relation==='plane-angle').every(c=>has(s.assembly,c.pieceA)&&has(s.assembly,c.pieceB))&&inspectSpatialConsistency(s.assembly,input).status!=='contradicted'}
    const score=(s:State)=>s.assembly.pieces.length+s.assembly.connections.length*.25+s.assembly.connections.reduce((n,c)=>{const h=s.context.hypotheses.find(h=>pair(h)===pair(c));return n+(h?.intent==='connect' ? .15 : -.2)+(h?.evidenceRefs.filter(r=>r.includes(':')).length??0)*.05},0)
    function enqueueRecovery(parent:State,ids:string[]){if(!ids.length)return;const key=parent.context.variantIndex+':'+stateKey({...parent.assembly,pieces:parent.assembly.pieces.filter(p=>ids.includes(p.id)),connections:parent.assembly.connections.filter(c=>ids.includes(c.pieceA)&&ids.includes(c.pieceB))});if(recoveryKeys.has(key)){stats.deduplicated++;return}recoveryKeys.add(key);recoveries.push({parent,ids})}
    function enqueueGrowth(s:State){
        const key=s.context.variantIndex+':'+stateKey(s.assembly);if(growthKeys.has(key))return;growthKeys.add(key)
        const choices=s.context.hypotheses.filter(c=>has(s.assembly,c.pieceA)!==has(s.assembly,c.pieceB)).sort((a,b)=>Number(overrides.some(h=>pair(h)===pair(b)))-Number(overrides.some(h=>pair(h)===pair(a)))||Number(b.intent==='connect')-Number(a.intent==='connect')||b.evidenceRefs.length-a.evidenceRefs.length||pair(a).localeCompare(pair(b))).flatMap(domain)
        if(!choices.length)return
        growth.push({state:s,choices,cursor:0,component:s.context.component.join('|')})
        // Bounded beam. Discarding frontier work never discards verified results.
        if(growth.length>beamWidth){growth.sort((a,b)=>score(b.state)-score(a.state)||a.cursor-b.cursor||stateKey(a.state.assembly).localeCompare(stateKey(b.state.assembly)));growth.pop();stats.beamPruned++}
    }
    function register(a:Assembly3D,context:Context,path:string[],phase:keyof ProgressiveStatistics['checks']):State|null{
        a=ordered(a);const key=context.variantIndex+':'+stateKey(a)
        if(seen.has(key)){stats.deduplicated++;return null}
        const exact=JSON.stringify({pieces:a.pieces,connections:a.connections}),cached=reports.get(exact)
        if(!cached&&checks>=maxChecks)return null
        seen.add(key);let geometry=cached
        if(geometry)stats.cacheHits++;else{checks++;stats.checks[phase]++;geometry=validateAssembly3D(a);reports.set(exact,geometry)}
        const s={assembly:a,geometry,context,path}
        if(geometry.valid){stats.acceptedStates++;valid.set(key,s);enqueueGrowth(s)}else{
            failed.set(key,s);for(const i of geometry.issues.filter(i=>i.severity==='error'))stats.failureCounts[i.code??'unknown']=(stats.failureCounts[i.code??'unknown']??0)+1
            diagnostics.add('GEOMETRY_REJECTED: '+JSON.stringify({pieces:a.pieces.map(p=>p.id),variant:context.variantIndex,geometry}))
            if(phase==='nominal')enqueueRecovery(s,a.pieces.map(p=>p.id))
        }
        return s
    }
    // Attempt nominal full components first with a small reserved share. Neither
    // Cartesian full graphs nor local recovery can consume the other's budget.
    const nominalLimit=Math.min(maxChecks,Math.max(1,Math.floor(maxChecks/8))),seedLimit=Math.min(maxChecks,nominalLimit+known.length)
    if(maxGraphs&&maxChecks)for(const [variantIndex,v] of variants.entries())for(const uncertain of [true,false]){
        if(stats.nominalGraphs>=maxGraphs){nominalTruncated=true;break}stats.nominalGraphs++
        const cs=v.connections.filter(c=>c.intent==='connect'||uncertain&&c.intent==='uncertain').map(c=>domain(c)[0]).filter((c):c is Connection=>!!c)
        const groups=components(known.map(p=>p.id),cs)
        for(const ids of groups){if(ids.length===1)continue;if(checks>=nominalLimit){nominalTruncated=true;break}
            const context={variantIndex,label:v.label,hypotheses:v.connections,component:components(known.map(p=>p.id),v.connections.filter(c=>domain(c).length)).find(c=>c.includes(ids[0]))!}
            try{register(solveAssembly3D(assembly(ids,cs.filter(c=>ids.includes(c.pieceA)&&ids.includes(c.pieceB)))),context,['nominal'], 'nominal')}catch(e){diagnostics.add('SOLVER_REJECTED: '+String(e))}
        }
    }
    if(maxGraphs&&maxChecks)for(const [variantIndex,v] of variants.entries())for(const p of known){if(checks>=seedLimit)break;const component=components(known.map(p=>p.id),v.connections.filter(c=>domain(c).length)).find(ids=>ids.includes(p.id))!;register(assembly([p.id],[]),{variantIndex,label:v.label,hypotheses:v.connections,component},['seed:'+p.id],'seed')}
    function witness(parent:State,ids:string[]){
        for(const i of parent.geometry.issues.filter(i=>i.severity==='error')){
            let members:string[]=[]
            if(i.code==='intersection')members=i.relatedPieceIds??[]
            else if(i.code==='port-reuse'&&i.relatedPieceIds?.length)members=[...new Set([i.pieceId!,...i.relatedPieceIds])]
            else if(i.code==='port-reuse'&&i.pieceId&&i.portId){const cs=parent.assembly.connections.filter(c=>c.pieceA===i.pieceId&&c.portA===i.portId||c.pieceB===i.pieceId&&c.portB===i.portId).slice(0,2);if(cs.length===2)members=[...new Set(cs.flatMap(c=>[c.pieceA,c.pieceB]))]}
            else if(i.connectionIndex!==undefined){const c=parent.assembly.connections[i.connectionIndex];if(c)members=[c.pieceA,c.pieceB]}
            if(members.length&&members.every(id=>ids.includes(id)))return members
        }
    }
    function recovery(){
        recoveries.sort((a,b)=>b.ids.length-a.ids.length||a.parent.context.variantIndex-b.parent.context.variantIndex||a.ids.join('|').localeCompare(b.ids.join('|')))
        const {parent,ids}=recoveries.shift()!,a={...parent.assembly,pieces:parent.assembly.pieces.filter(p=>ids.includes(p.id)),connections:parent.assembly.connections.filter(c=>ids.includes(c.pieceA)&&ids.includes(c.pieceB))},groups=components(ids,a.connections)
        if(groups.length>1){for(const group of groups)enqueueRecovery(parent,group);return}
        let conflict=witness(parent,ids)
        if(conflict)stats.proofPruned++
        else{const s=register(a,parent.context,[...parent.path,'recover:'+ids.join(',')],'recovery');if(!s||s.geometry.valid)return;conflict=witness(s,ids)??ids}
        for(const id of conflict)enqueueRecovery(parent,ids.filter(p=>p!==id))
    }
    function addClosures(a:Assembly3D,ctx:Context){
        const transforms=Object.fromEntries(a.pieces.map(p=>[p.id,toEnginePose(p.pose)])),required=new Set(hard(ctx).map(pair))
        for(const h of ctx.hypotheses.filter(c=>has(a,c.pieceA)&&has(a,c.pieceB)&&!a.connections.some(x=>pair(x)===pair(c)))){
            const values=domain(h).map(c=>({c,r:computeAllConnectionResiduals([c],transforms,id=>shape(a,id))[0]})).filter(x=>x.r).sort((a,b)=>(a.r.positionError+a.r.dihedralError/180)-(b.r.positionError+b.r.dihedralError/180))
            // This tight match is only a proposal filter, never a replacement
            // tolerance. The complete strict Validator checks every proposal.
            const chosen=values.find(({r})=>r.positionError<1e-7&&r.directionDot>1-1e-8&&r.dihedralError<1e-6)?.c
            if(chosen){
                // With actual poses, reject only proved directional conflicts.
                const proposed={...a,connections:[...a.connections,chosen]}
                if(portCompatibility(proposed).status!=='conflict')a.connections.push(chosen)
                else if(required.has(pair(h)))a.connections.push(chosen)
            }
            else if(required.has(pair(h))&&values.length)a.connections.push(values[0].c)
        }
        return a
    }
    function expand(){
        const groups=[...new Set(growth.map(g=>g.component))].sort();const group=groups[componentTurn++%groups.length]
        const pool=growth.filter(g=>g.component===group).sort((a,b)=>(score(b.state)-b.cursor*.2)-(score(a.state)-a.cursor*.2)||stateKey(a.state.assembly).localeCompare(stateKey(b.state.assembly))),job=pool[0],c=job.choices[job.cursor++]
        if(job.cursor>=job.choices.length)growth.splice(growth.indexOf(job),1)
        try{const id=has(job.state.assembly,c.pieceA)?c.pieceB:c.pieceA,proposal=addClosures(attachProgressivePiece(job.state.assembly,piece(id),c),job.state.context)
            if(portCompatibility(proposal).status==='conflict'){stats.portPruned++;return}
            stats.growthExpansions++;stats.reusedPosePieces+=job.state.assembly.pieces.length
            register(proposal,job.state.context,[...job.state.path,`attach:${id}:${JSON.stringify(c)}`],'growth')
        }catch(e){diagnostics.add('ATTACH_REJECTED: '+String(e))}
    }
    while(maxGraphs&&checks<maxChecks&&stats.nodes<maxNodes&&(growth.length||recoveries.length)){
        stats.nodes++;if(recoveries.length&&(!growth.length||round++%4===0))recovery();else expand()
    }
    stats.termination=!maxGraphs?'assignment-budget':checks>=maxChecks?'geometry-budget':stats.nodes>=maxNodes&&(growth.length||recoveries.length)?'node-budget':stats.beamPruned?'beam-pruned':nominalTruncated?'nominal-budget':'frontier-exhausted'
    const completeSearch=stats.termination==='frontier-exhausted'
    const accepted=[...valid.values()].filter(eligible),connected=accepted.filter(s=>s.assembly.connections.length),verifiedUnion=new Set(connected.flatMap(s=>s.assembly.pieces.map(p=>p.id)))
    const reviewBlocked=valid.size-accepted.length
    if(reviewBlocked)diagnostics.add(`REVIEW_BLOCKED: ${reviewBlocked} 个几何合法状态缺少或违反人工硬约束 / 已审核空间关系，未提供为可采用 Candidate。`)
    stats.maxConnected=Math.max(0,...connected.map(s=>s.assembly.pieces.length));stats.verifiedConnectedUnion=[...verifiedUnion].sort();stats.standaloneVerified=[...new Set(accepted.filter(s=>s.assembly.pieces.length===1).map(s=>s.assembly.pieces[0].id))].sort();stats.unplaced=confirmed.filter(p=>!verifiedUnion.has(p.id)).map(p=>p.id)
    // Remove only pose/connection-preserving substructures. Incompatible angles
    // and alternative interpretations remain distinct, never merged in space.
    const ranked=accepted.sort((a,b)=>score(b)-score(a)||stateKey(a.assembly).localeCompare(stateKey(b.assembly))),maximal=ranked.filter((s,i)=>!ranked.slice(0,i).some(p=>p.context.variantIndex===s.context.variantIndex&&s.assembly.pieces.every(x=>p.assembly.pieces.some(y=>y.id===x.id))&&s.assembly.connections.every(c=>p.assembly.connections.some(x=>JSON.stringify(x)===JSON.stringify(c)))&&stateKey(s.assembly)===stateKey({...p.assembly,pieces:p.assembly.pieces.filter(x=>has(s.assembly,x.id)),connections:p.assembly.connections.filter(c=>has(s.assembly,c.pieceA)&&has(s.assembly,c.pieceB))})))
    function candidate(s:State,kind:'candidate'|'diagnostic'):VisibleCandidate3D{
        const ids=s.assembly.pieces.map(p=>p.id),omitted=s.context.hypotheses.filter(h=>h.intent!=='separate'&&!s.assembly.connections.some(c=>pair(c)===pair(h)))
        return {id:'pending',kind,assembly:structuredClone(s.assembly),geometry:s.geometry,validation:assemblyValidationLayers(s.geometry),observationMap:candidateObservationMap(s.assembly,input),spatialConsistency:inspectSpatialConsistency(s.assembly,input),coverage:{reconstructed:ids,unresolved:input.review.pieces.filter(p=>!p.excluded&&!ids.includes(p.id)).map(p=>p.id),excluded,totalConfirmed:confirmed.length},photoMatch:{status:'unverified',score:null},rank:0,frame:'component-local-unregistered',interpretation:s.context.label+' · progressive partial',construction:{variantIndex:s.context.variantIndex,combinationIndex:0,componentPieceIds:s.context.component,source:'progressive-growth',omittedHypotheses:structuredClone(omitted),parentConnections:structuredClone(s.assembly.connections),growthPath:s.path},unverifiedConstraints:[...plan.unknowns,...plan.relations.map(r=>`${r.from}/${r.to}: ${r.kind} 图片关系未作重投影验证`),`SEARCH_SCOPE: ${stats.termination}；已严格验证此部分结构，不代表搜索完成。`,`CONSTRAINT_COVERAGE: ${omitted.length} 条原连接假设未满足，完整差异保存在 construction.omittedHypotheses。`,'PARTIAL: 连通部分结构；未放置实例保留来源，不随意赋予世界坐标。','Photo Match / 绝对空间位置 / Physical Stability 未验证。',...(kind==='diagnostic'?['DIAGNOSTIC_ONLY: 严格 Validator 未通过，禁止普通采用。']:[])]}
    }
    const representatives:State[]=[]
    for(const component of stats.graphComponents){
        const best=maximal.find(s=>s.assembly.connections.length&&s.assembly.pieces.every(p=>component.includes(p.id)))
        if(best){representatives.push(best);stats.componentResults.push({observations:component,best:best.assembly.pieces.map(p=>p.id),connections:best.assembly.connections.length})}
    }
    stats.independentComponentCoverage=[...new Set(representatives.flatMap(s=>s.assembly.pieces.map(p=>p.id)))].sort()
    const chosen=[...new Set([...representatives.sort((a,b)=>score(b)-score(a)),...maximal])].slice(0,topK)
    const candidates=chosen.map((s,i)=>{const c=candidate(s,'candidate');c.id=`candidate-${i+1}`;c.rank=i+1;c.assembly.id=`visible-${i+1}`;return c})
    stats.returnedUnion=[...new Set(candidates.filter(c=>c.assembly.connections.length).flatMap(c=>c.coverage.reconstructed))].sort()
    const diagnosticCandidates=[...failed.values()].sort((a,b)=>b.assembly.pieces.length-a.assembly.pieces.length||stateKey(a.assembly).localeCompare(stateKey(b.assembly))).slice(0,maxDiagnostics).map((s,i)=>{const c=candidate(s,'diagnostic');c.id=`diagnostic-${i+1}`;c.rank=i+1;c.assembly.id=c.id;c.collisions=inspectAssemblyCollisions(c.assembly,c.geometry);return c})
    const explanation=[`PROGRESSIVE_SEARCH: ${stats.termination}；保留已严格验证的部分 Candidate；completeSearch=${completeSearch} 不等于几何结果无效。`,'COVERAGE_UNION: verifiedConnectedUnion 是不同候选的独立证据覆盖并集，不是一个共同位姿下的 Assembly；单片验证另计，不算连通重建。',...(stats.graphComponents.length>1?['MULTIPLE_COMPONENTS: 未知相对位姿的组件分别搜索，不伪造连接或整体位置。']:[]),...(reviewBlocked?[`REVIEW_BLOCKED: ${reviewBlocked} 个状态不满足人工硬约束或已审核空间关系。`]:[]),...(!completeSearch?['BUDGET_OR_BEAM_LIMIT: 未完成有限搜索；尚未找到的结构不代表无解。']:[])]
    return {version:5,status:candidates.length?'candidates_found':!completeSearch?'budget_exhausted':'no_valid_candidate',completeSearch,search:{assignments:stats.nominalGraphs,geometryChecks:checks,maxAssignments:maxGraphs,maxGeometryChecks:maxChecks,progressive:stats},candidates,diagnosticCandidates,diagnostics:[...explanation,...diagnostics].slice(0,50)}
}
