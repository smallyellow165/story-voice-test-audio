import { validateBrickDesign, designLimits } from '../../src/brick-design-validation.mjs'

const EPS = 1e-7
const key = b => [b.id, b.part, b.color, b.x, b.z, b.layer, b.rotation].join(':')
const stateKey = bs => [...bs].sort((a,b) => a.id.localeCompare(b.id)).map(key).join('|')
const normalize = bs => { const floor = Math.min(...bs.map(b => b.layer)); return bs.map(b => ({ ...b, layer: b.layer - floor })) }
const weight = r => Number.isFinite(r.confidence) && r.confidence >= 0 && r.confidence <= 1
  ? r.confidence * (r.status === 'observed' ? 1 : r.status === 'inferred' ? 0.7 : 0) : 0

// These are nominal connector-contact hypotheses, NOT a second solid geometry engine.
// Shared V2 computes every collision and every connection.
function pairReport(a, b, rules) { return rules.validateAssembly(normalize([a,b])) }
export function assessRelations(bricks, relations, rules, hints = {}) {
  const byId = new Map(bricks.map(b => [b.id,b]))
  return relations.map((r, index) => {
    const a = byId.get(r.from), b = byId.get(r.to)
    let satisfied = null, interpretation = 'not evaluated'
    if (a && b) {
      if (r.relation === 'supports' || r.relation === 'contact') {
        const pair = pairReport(a,b,rules)
        satisfied = pair.valid && pair.connections.some(c => r.relation === 'contact' || (c.lowerId === a.id && c.upperId === b.id))
        interpretation = r.relation === 'contact' ? 'compatible top/bottom connector contact; side contact not evaluated' : 'direct compatible lower-to-upper connection'
      } else if (r.relation === 'left' && hints.leftAxis === 'x') {
        satisfied = a.x < b.x - EPS
        interpretation = 'centre ordering in explicitly chosen world X; not a calibrated camera projection'
      }
    }
    // Unknown evidence is retained for inspection but never contributes a score.
    return { index, evidence: r, weight: weight(r), satisfied, interpretation }
  })
}
function assessHints(bricks, hints, rules) {
  const result = []
  for (const id of hints?.groundIds || []) {
    const b = bricks.find(b => b.id === id)
    if (b) result.push({ type:'ground', ids:[id], satisfied:b.layer < EPS, status:'experiment_hypothesis', weight:0.5 })
  }
  for (const [aId,bId] of hints?.separatedPairs || []) {
    const a=bricks.find(b=>b.id===aId), b=bricks.find(b=>b.id===bId)
    if (a && b && hints.leftAxis === 'x') {
      const gap = Math.abs(a.x-b.x)-(rules.dimensions(a.part,a.rotation).width+rules.dimensions(b.part,b.rotation).width)/2
      result.push({type:'horizontal_gap',ids:[aId,bId],gapStuds:gap,satisfied:gap>EPS,status:'experiment_hypothesis',weight:0.5})
    }
  }
  return result
}
function score(bricks, input, rules) {
  const relations = assessRelations(bricks,input.relations || [],rules,input.hints)
  let value = relations.reduce((n,r) => n + (r.satisfied === true ? r.weight : r.satisfied === false ? -r.weight : 0),0)
  value += assessHints(bricks,input.hints,rules).reduce((n,h)=>n+(h.satisfied?h.weight:-h.weight),0)
  return value
}

// Enumerate both directions: a newly placed part may support an existing one.
// Thus search order is deliberately independent of construction order.
function* alignments(observation, existing, rules) {
  const definition = rules.PARTS.find(p => p.id === observation.part)
  for (const rotation of definition.geometry.rotations) {
    const origin = { id: observation.id, part: observation.part, color: observation.color, x: 0, z: 0, layer: 0, rotation }
    for (const anchor of existing) for (const [face, other] of [['bottom','top'],['top','bottom']]) {
      for (const moving of rules.connectors(origin,face)) for (const fixed of rules.connectors(anchor,other)) {
        const top = face === 'top' ? moving : fixed, bottom = face === 'bottom' ? moving : fixed
        if (top.type !== bottom.type || top.direction !== 'up' || bottom.direction !== 'down' || bottom.radiusLdu < top.radiusLdu || bottom.depthLdu < top.depthLdu) continue
        yield { ...origin, x: (fixed.x-moving.x)/rules.STUD_LDU, z: (fixed.z-moving.z)/rules.STUD_LDU, layer: (fixed.y-moving.y)/rules.BODY_LDU }
      }
    }
  }
}
function supportReport(bricks, geometry, rules) {
  return bricks.map(b => {
    const total = rules.footprint(b).length
    const supported = geometry.connections.filter(c => c.upperId === b.id).reduce((n,c) => n+c.points.length,0)
    const required = Math.ceil(total * designLimits.minSupportFraction)
    return { observationId: b.id, grounded: b.layer < EPS, supported, total, required,
      passesExistingThreshold: b.layer < EPS || supported >= required }
  })
}
function inputErrors(input, rules) {
  const errors = [], ids = new Set(), quantities = new Map(), used = new Map()
  if (!Array.isArray(input.observations) || !input.observations.length || input.observations.length > 20) return ['Need 1–20 mapped observations']
  if (!Array.isArray(input.inventory)) return ['Inventory is required']
  for (const r of input.inventory) {
    if (!r || typeof r.part !== 'string' || typeof r.color !== 'string') { errors.push('Invalid inventory row'); continue }
    const k = r.part + ':' + r.color
    if (!Number.isInteger(r.quantity) || r.quantity < 0 || quantities.has(k)) errors.push('Invalid or duplicate inventory: '+k)
    quantities.set(k,r.quantity)
  }
  if (input.hints?.groundIds !== undefined && (!Array.isArray(input.hints.groundIds) || input.hints.groundIds.some(id => typeof id !== 'string'))) return ['groundIds must be a string array']
  if (input.hints?.separatedPairs !== undefined && (!Array.isArray(input.hints.separatedPairs) || input.hints.separatedPairs.some(p => !Array.isArray(p) || p.length !== 2 || p.some(id => typeof id !== 'string')))) return ['separatedPairs must contain ID pairs']
  if (input.relations !== undefined && (!Array.isArray(input.relations) || input.relations.some(r => !r || typeof r !== 'object'))) return ['Relations must be an array of records']
  for (const o of input.observations) {
    if (!o || typeof o !== 'object') { errors.push('Invalid observation'); continue }
    if ( !/^[a-zA-Z0-9_-]{1,40}$/.test(o.id) || ids.has(o.id)) errors.push('Invalid or duplicate observation ID')
    ids.add(o.id)
    if (!rules.geometrySupport(o.part).supported || !rules.COLORS.some(c => c.code === o.color)) errors.push('Unsupported part/color: '+o.id)
    const k = o.part+':'+o.color
    used.set(k,(used.get(k)||0)+1)
  }
  for (const [k,n] of used) if (n > (quantities.get(k)||0)) errors.push('Inventory exceeded: '+k)
  return errors
}

export function solveGeometry(input, rules, options = {}) {
  const config = { beamWidth: 128, maxExpansions: 250000, maxMs: 30000, maxCandidates: 8, maxCoordinate: 6, maxTop: 8, ...options }
  for (const [k,v] of Object.entries(config)) if (!Number.isFinite(v) || v <= 0 || (['beamWidth','maxExpansions','maxCandidates'].includes(k) && !Number.isInteger(v))) throw new Error('Invalid budget: '+k)
  const started = performance.now()
  const stats = { expanded: 0, duplicates: 0, collisionRejected: 0, boundsRejected: 0, geometryRejected: 0, beamPruned: 0, deepest: 0, elapsedMs: 0 }
  const output = { status: '', termination: '', completeSearch: false, scoringPolicy: { observedMultiplier:1, inferredMultiplier:0.7, unknownMultiplier:0, hypothesisWeight:0.5, note:'Heuristic ranking, not calibrated probabilities. Correlated contact/support evidence can be counted twice.' }, config, stats, candidates: [], diagnostics: [],
    domain: 'Upright connector-aligned connected layouts; fixed observation assignment order; bounded coordinates. Relations are soft; no proof of global unsatisfiability.' }
  const errors = !input || typeof input !== 'object' ? ['Input object required'] : inputErrors(input,rules)
  if (errors.length) return { ...output, status: 'infeasible_input', diagnostics: errors }
  if (!(input.relations || []).some(r => ['supports','contact'].includes(r.relation) && weight(r) > 0)) return { ...output, status: 'insufficient_information', diagnostics: ['No usable connector-contact relations; production LLM path is untouched.'] }
  const ids = new Set(input.observations.map(o => o.id))
  output.diagnostics.push(...(input.relations || []).filter(r => !ids.has(r.from) || !ids.has(r.to)).map(r => 'Unknown relation endpoint: '+r.from+' -> '+r.to))
  const degree = id => (input.relations || []).filter(r => r.from === id || r.to === id).reduce((n,r) => n+weight(r),0)
  const ordered = [...input.observations].sort((a,b) => degree(b.id)-degree(a.id) || a.id.localeCompare(b.id))
  const root = ordered[0], assigned = new Set([root.id])
  // Root rotation is not fixed: directional visual hints break rotational symmetry.
  let beam = rules.PARTS.find(p => p.id === root.part).geometry.rotations.map(rotation => ({ bricks: [{ id:root.id, part:root.part, color:root.color, x:0,z:0,layer:0,rotation }], score: 0 }))
  let budget = ''
  for (let depth=1; depth<ordered.length; depth++) {
    const linkedWeight = o => (input.relations || []).filter(r => (r.from===o.id && assigned.has(r.to)) || (r.to===o.id && assigned.has(r.from))).reduce((n,r)=>n+weight(r),0)
    const next = ordered.filter(o=>!assigned.has(o.id)).sort((a,b)=>linkedWeight(b)-linkedWeight(a)||degree(b.id)-degree(a.id)||a.id.localeCompare(b.id))[0]
    const pool = new Map(), seen = new Set()
    outer: for (const state of beam) for (const placement of alignments(next,state.bricks,rules)) {
      if (stats.expanded >= config.maxExpansions) { budget='expansion_budget'; break outer }
      if (performance.now()-started >= config.maxMs) { budget='time_budget'; break outer }
      stats.expanded++
      const bricks = normalize([...state.bricks,placement]), signature = stateKey(bricks)
      if (seen.has(signature)) { stats.duplicates++; continue }
      seen.add(signature)
      if (bricks.some(b => !rules.validPosition(b) || Math.abs(b.x)>config.maxCoordinate || Math.abs(b.z)>config.maxCoordinate || b.layer + rules.PARTS.find(p=>p.id===b.part).geometry.bodySizeLdu.y/rules.BODY_LDU > config.maxTop)) { stats.boundsRejected++; continue }
      const partial = rules.validateAssembly(bricks)
      // An unsupported/disconnected partial assembly can be completed later.
      if (partial.code === 'COLLISION') { stats.collisionRejected++; continue }
      pool.set(signature,{bricks,score:score(bricks,input,rules),signature})
    }
    const ranked = [...pool.values()].sort((a,b)=>b.score-a.score || a.signature.localeCompare(b.signature))
    stats.beamPruned += Math.max(0,ranked.length-config.beamWidth)
    beam = ranked.slice(0,config.beamWidth)
    assigned.add(next.id); stats.deepest = assigned.size
    if (budget || !beam.length) break
  }
  if (assigned.size === ordered.length) for (const state of beam) {
    const geometry = rules.validateAssembly(state.bricks)
    if (!geometry.valid) { stats.geometryRejected++; if (stats.geometryRejected <= 5) output.diagnostics.push({stage:'final_geometry',code:geometry.code,reason:geometry.reason,brickIds:geometry.brickIds}); continue }
    const bricks = [...state.bricks].sort((a,b)=>a.layer-b.layer||a.id.localeCompare(b.id))
    const design = { name: 'Geometry Solver candidate', bricks, steps: bricks.map(b=>({brickId:b.id,instruction:'放置识别项 '+b.id+'；此顺序仅作诊断，未承诺可逐步搭建。'})) }
    const relations = assessRelations(bricks,input.relations || [],rules,input.hints)
    const evaluated = relations.filter(r=>r.weight>0 && r.satisfied!==null)
    const totalWeight = evaluated.reduce((n,r)=>n+r.weight,0)
    output.candidates.push({ design, observationPlacements: Object.fromEntries(bricks.map(b=>[b.id,b])), geometry,
      reference: { score: totalWeight ? evaluated.reduce((n,r)=>n+(r.satisfied?r.weight:0),0)/totalWeight : null, relations,
        satisfied: evaluated.filter(r=>r.satisfied).length, violated: evaluated.filter(r=>!r.satisfied).length, notEvaluated: relations.filter(r=>r.satisfied===null || !r.weight).length },
      searchScore: state.score, hints: assessHints(bricks,input.hints,rules), support: supportReport(bricks,geometry,rules),
      buildOrder: { strategy: 'bottom elevation then observation ID; diagnostic only, not a step solver', report: validateBrickDesign(design,input.inventory,rules) } })
  }
  output.candidates.sort((a,b)=>b.searchScore-a.searchScore || stateKey(a.design.bricks).localeCompare(stateKey(b.design.bricks)))
  output.candidates = output.candidates.slice(0,config.maxCandidates)
  output.termination = budget || 'enumerated_domain_finished'
  output.status = output.candidates.length ? 'candidates_found' : budget ? 'budget_exhausted' : stats.geometryRejected ? 'geometry_validation_failed' : 'no_candidate_in_explored_domain'
  stats.elapsedMs = Math.round(performance.now()-started)
  output.diagnostics.push('Beam pruning and fixed placement order mean no global no-solution claim. A found geometry is not proof of photo fidelity or physical stability.')
  return output
}
