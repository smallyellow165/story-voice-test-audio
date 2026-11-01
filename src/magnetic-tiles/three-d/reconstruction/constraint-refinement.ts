import {parseSpatialHypothesis} from './contracts.ts'
import {hypothesisPortConflicts} from './port-constraints.ts'
import type {ConnectionHypothesis3D,SpatialHypothesis3D,VisibleInput3D} from './contracts.ts'

export type RefinementOptions = {maxNodes?:number;maxCandidates?:number;protectPlan?:boolean}
export type RefinementConflict = {port:string;pairs:string[];hardPairs:string[]}
export type RefinementCandidate = {
    id:string;variantIndex:number;label:string;plan:SpatialHypothesis3D;
    retained:ConnectionHypothesis3D[];
    removed:{constraint:ConnectionHypothesis3D;reason:string;conflicts:RefinementConflict[];unverifiedPorts?:string[]}[];
    observations:string[];evidenceScore:number;
    consistency:{portConflicts:RefinementConflict[];status:'port-consistent'|'unverified';geometry:'not-executed';photoMatch:'unverified'};
}
export type ConstraintRefinement = {
    version:1;algorithm:'port-conflict-subsets-v1';options:Required<RefinementOptions>;
    search:{considered:number;complete:boolean};
    conflicts:{variantIndex:number;label:string;conflicts:RefinementConflict[];unverifiedPorts?:string[]}[];
    blockers:string[];candidates:RefinementCandidate[];
}
export type RefinementReference = {id:string;hash:string;candidateId:string;candidateHash:string}
export const connectionPair=(c:{pieceA:string;pieceB:string})=>[c.pieceA,c.pieceB].sort().join('|')
function portConflicts(cs:ConnectionHypothesis3D[],hard:Set<string>,input:VisibleInput3D):RefinementConflict[]{
    return hypothesisPortConflicts(cs,input).conflicts.map(c=>({...c,hardPairs:c.pairs.filter(p=>hard.has(p))}))
}
/** Pure, bounded topology refinement. Never guesses new ports, angles, pieces or
 * poses. Review constraints override model hypotheses exactly as in Execution.
 * Unknown ports/angles stay Unknown; only proved directional conflicts may remove hypotheses; geometry remains unverified. */
export function refineConstraints(planValue:SpatialHypothesis3D,input:VisibleInput3D,options:RefinementOptions={}):ConstraintRefinement{
    const plan=parseSpatialHypothesis(planValue,input)
    const settings={maxNodes:options.maxNodes??4096,maxCandidates:options.maxCandidates??12,protectPlan:options.protectPlan??false}
    if(!Number.isSafeInteger(settings.maxNodes)||settings.maxNodes<1||settings.maxNodes>8192||!Number.isSafeInteger(settings.maxCandidates)||settings.maxCandidates<1||settings.maxCandidates>32)throw Error('Refinement 搜索预算无效')
    const overrides=input.review.constraints,overridePairs=new Set(overrides.map(connectionPair))
    const hard=new Set([...overridePairs,...(input.review.spatialChecks??[]).filter(s=>s.relation==='shared-edge').map(connectionPair)])
    const variants=[{label:'primary',connections:plan.connections},...plan.alternatives]
    const result:ConstraintRefinement={version:1,algorithm:'port-conflict-subsets-v1',options:settings,search:{considered:0,complete:true},conflicts:[],blockers:[],candidates:[]}
    for(const [variantIndex,variant] of variants.entries()){
        const cs=[...variant.connections.filter(c=>!overridePairs.has(connectionPair(c))),...overrides]
        const locked=new Set([...hard,...(settings.protectPlan?cs.map(connectionPair):[])])
        const initial=portConflicts(cs,locked,input)
        result.conflicts.push({variantIndex,label:variant.label,conflicts:initial,unverifiedPorts:hypothesisPortConflicts(cs,input).unverifiedPorts})
        if(initial.some(c=>c.hardPairs.length>1)){
            result.blockers.push(`${variant.label}: 人工硬约束冲突，不能自动舍弃：${initial.filter(c=>c.hardPairs.length>1).map(c=>c.port+' ['+c.hardPairs.join(', ')+']').join('; ')}`)
            continue
        }
        if(!initial.length)continue
        const queue:number[][]=[cs.map((_,i)=>i)],seen=new Set<string>(),leaves:number[][]=[]
        while(queue.length){
            if(result.search.considered>=settings.maxNodes){result.search.complete=false;break}
            const ids=queue.shift()!,key=ids.join(',');if(seen.has(key))continue;seen.add(key);result.search.considered++
            const remaining=ids.map(i=>cs[i]),conflict=portConflicts(remaining,locked,input)[0]
            if(!conflict){leaves.push(ids);continue}
            // Every compatible subset must remove at least one member of this
            // exact occupancy conflict. Locked human constraints never branch.
            const witness=conflict.hardPairs.length?[conflict.hardPairs[0],conflict.pairs.find(p=>p!==conflict.hardPairs[0])!]:conflict.pairs.slice(0,2)
            for(const pair of witness.filter(p=>!locked.has(p)))queue.push(ids.filter(i=>connectionPair(cs[i])!==pair))
        }
        const maximal=leaves.filter(ids=>!leaves.some(other=>other.length>ids.length&&ids.every(i=>other.includes(i))))
        for(const ids of maximal){
            const kept=new Set(ids),retained=cs.filter((_,i)=>kept.has(i)),removed=cs.filter((_,i)=>!kept.has(i))
            const refined=parseSpatialHypothesis({...plan,connections:retained,alternatives:[]},input)
            result.candidates.push({id:'pending',variantIndex,label:variant.label,plan:refined,retained,
                removed:removed.map(c=>({constraint:c,reason:'明确角度的所有可选连接均产生相同空间方向占位；未经人工确认的假设未采用，不代表照片中不存在。',conflicts:initial.filter(x=>x.pairs.includes(connectionPair(c)))})),
                observations:[...new Set(initial.flatMap(c=>c.pairs.flatMap(p=>p.split('|'))))].sort(),
                // Observable references, not a fabricated photo-match score.
                evidenceScore:retained.reduce((n,c)=>n+c.evidenceRefs.filter(r=>r.includes(':')).length,0),
                consistency:{portConflicts:portConflicts(retained,locked,input),status:hypothesisPortConflicts(retained,input).unverifiedPorts.length?'unverified':'port-consistent',geometry:'not-executed',photoMatch:'unverified'}})
        }
        if(!result.search.complete)break
    }
    result.candidates.sort((a,b)=>b.evidenceScore-a.evidenceScore||a.removed.length-b.removed.length||a.variantIndex-b.variantIndex||JSON.stringify(a.retained).localeCompare(JSON.stringify(b.retained)))
    const unique=new Set<string>()
    result.candidates=result.candidates.filter(c=>{const key=JSON.stringify(c.plan);if(unique.has(key))return false;unique.add(key);return true}).slice(0,settings.maxCandidates).map((c,i)=>({...c,id:`refinement-${i+1}`}))
    return structuredClone(result)
}
