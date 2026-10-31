import { assertAssembly3D, fromEnginePose, toEnginePose } from './assembly.ts'
import type { Assembly3D } from './assembly.ts'
import { createShapeCatalog, profileKey3D } from './profile-adapter.ts'
import { solveConnections } from './vendor/engine/solver.ts'
import { validatePhysicalModel,inspectCollisionPair } from './vendor/engine/validator.ts'
import type { PhysicalModel } from './vendor/engine/types.ts'

function context(a: Assembly3D) {
  assertAssembly3D(a)
  const catalog = createShapeCatalog(a.profiles)
  const shapes = new Map(a.pieces.map(p => [p.id, catalog.get(profileKey3D({ id: p.profileId, version: p.profileVersion }))!.shape]))
  const pieces = a.pieces.map(p => ({ id: p.id, partId: profileKey3D({ id: p.profileId, version: p.profileVersion }) }))
  return { getShapeForPiece: (id: string) => shapes.get(id), pieces }
}

/** Explicit operation: solve each connected component from its saved root pose.
 * Loading never calls this. No grounding; singleton/free piece poses remain exact.
 */
export function solveAssembly3D(input: Assembly3D, roots: readonly string[] = []): Assembly3D {
  const { pieces, getShapeForPiece } = context(input)
  if (new Set(roots).size !== roots.length || roots.some(id => !pieces.some(p => p.id === id))) throw Error('Invalid 3D root selection')
  const assembly = structuredClone(input), pending = new Set(pieces.map(p => p.id))
  const poses = new Map(assembly.pieces.map(p => [p.id, p]))
  while (pending.size) {
    const first = [...pending].sort()[0], component = new Set([first]), queue = [first]
    while (queue.length) {
      const id = queue.shift()!
      for (const c of assembly.connections) {
        const next = c.pieceA === id ? c.pieceB : c.pieceB === id ? c.pieceA : undefined
        if (next && !component.has(next)) { component.add(next); queue.push(next) }
      }
    }
    const selected = roots.filter(id => component.has(id))
    if (selected.length > 1) throw Error('Only one solver root per connected component')
    const rootPieceId = selected[0] ?? first
    const result = solveConnections({ pieces: pieces.filter(p => component.has(p.id)),
      connections: assembly.connections.filter(c => component.has(c.pieceA)), rootPieceId,
      rootTransform: toEnginePose(poses.get(rootPieceId)!.pose), groundLock: false, getShapeForPiece })
    if (result.error) throw Error(result.error)
    for (const id of component) {
      // Do not round-trip the authoritative root/singleton through math objects.
      if (id !== rootPieceId) poses.get(id)!.pose = fromEnginePose(result.transforms[id])
      pending.delete(id)
    }
  }
  return assembly
}

/** Check the stored poses, including free pieces and cross-component collisions. */
export function validateAssembly3D(assembly: Assembly3D, options: { checkGround?: boolean; requireConnected?: boolean } = {}) {
  const { pieces, getShapeForPiece } = context(assembly)
  const model: PhysicalModel = {
    id: assembly.id, name: assembly.id, theme: 'other', difficulty: 'easy', ageRange: '', minAge: 0, maxAge: 0,
    estimatedTime: '', coverImage: '', description: '', buildMode: 'solid', parts: [], skills: [], parentTips: [],
    pieces, connections: assembly.connections, steps: [],
  }
  return validatePhysicalModel(model, getShapeForPiece, {
    transforms: Object.fromEntries(assembly.pieces.map(p => [p.id, toEnginePose(p.pose)])),
    checkSteps: false, checkSemantics: false, checkStability: false,
    checkGround: options.checkGround ?? false, requireConnected: options.requireConnected ?? false,
  })
}

/** Diagnostic projection of the strict report. Full Geometry Valid is unchanged. */
export function assemblyValidationLayers(report:ReturnType<typeof validateAssembly3D>){
  const collisionIssues=report.issues.filter(i=>i.code==='intersection'),idealIssues=report.issues.filter(i=>i.code!=='intersection');
  return {idealGeometry:{valid:!idealIssues.some(i=>i.severity==='error'),issues:idealIssues},solidCollision:{valid:!collisionIssues.some(i=>i.severity==='error'),issues:collisionIssues}};
}
export function inspectAssemblyCollisions(assembly:Assembly3D,report=validateAssembly3D(assembly)){
  const {getShapeForPiece}=context(assembly);
  return report.issues.filter(i=>i.code==='intersection'&&i.relatedPieceIds).slice(0,24).map(issue=>{
    const [a,b]=issue.relatedPieceIds!,pa=assembly.pieces.find(p=>p.id===a)!,pb=assembly.pieces.find(p=>p.id===b)!;
    return {pieceIds:[a,b],...inspectCollisionPair(getShapeForPiece(a)!,toEnginePose(pa.pose),getShapeForPiece(b)!,toEnginePose(pb.pose)),declaredConnection:assembly.connections.some(c=>[c.pieceA,c.pieceB].includes(a)&&[c.pieceA,c.pieceB].includes(b))};
  });
}
