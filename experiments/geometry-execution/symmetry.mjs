// Exact quarter-turn proof. No dimension/name heuristics and no epsilon merging.
const rotate=(p,yaw)=>yaw===0?{...p}:yaw===90?{...p,x:p.z,z:-p.x}:yaw===180?{...p,x:-p.x,z:-p.z}:{...p,x:-p.z,z:p.x}
const setKey=values=>JSON.stringify(values.map(v=>JSON.stringify(v)).sort())
const point=p=>[p.x,p.y,p.z]
const connector=p=>[p.x,p.y,p.z,p.type,p.direction,p.radiusLdu,p.depthLdu]
const box=(b,yaw)=>{const a=rotate(b.min,yaw),c=rotate(b.max,yaw);return ['x','y','z'].flatMap(k=>[Math.min(a[k],c[k]),Math.max(a[k],c[k])])}
export function proveRotations(profile,model){
 if(!model.available||model.errors.length||!model.extraction?.uniformInheritedColor||!model.extraction.surfaceFaces?.length)return null
 const faces=model.extraction.surfaceFaces.map(face=>face.map(([x,y,z])=>({x:x+profile.ldraw.offsetLdu.x,y:-y+profile.ldraw.offsetLdu.y,z:-z+profile.ldraw.offsetLdu.z})))
 const signatures=new Map(),classes={},permutations={}
 for(const yaw of profile.rotations){
  const size=rotate(profile.bodySizeLdu,yaw)
  const signature=JSON.stringify([Math.abs(size.x),size.y,Math.abs(size.z),profile.outerBoundsLdu?box(profile.outerBoundsLdu,yaw):null,setKey(profile.collision.boxes.map(b=>box(b,yaw))),
   ...['top','bottom'].map(side=>setKey(profile[side].map(p=>connector(rotate(p,yaw))))),setKey(faces.map(face=>setKey(face.map(p=>point(rotate(p,yaw))))))])
  if(!signatures.has(signature))signatures.set(signature,yaw)
  const representative=signatures.get(signature);classes[yaw]=representative
  permutations[yaw]=Object.fromEntries(['top','bottom'].map(side=>[side,profile[side].map(p=>{
   const key=JSON.stringify(connector(rotate(p,yaw)))
   return profile[side].findIndex(q=>JSON.stringify(connector(rotate(q,representative)))===key)
  })]))
 }
 return {classes,permutations}
}
export function executionSymmetry(plan,observations,proofs){
 const indexed=new Set()
 for(const p of plan.parts)for(const c of p.connections){if(c.ownConnector!==null)indexed.add(p.id);if(c.otherConnector!==null)indexed.add(c.other)}
 const records=plan.parts.map(p=>{
  const o=observations.get(p.id),proof=proofs.find(r=>r.id===p.id&&r.part===o.part&&r.profile===JSON.stringify(o.geometry))
  const allowed=proof&&!indexed.has(p.id)&&!o.mapping?.geometryBinding
  return {id:p.id,classes:Object.fromEntries(p.pose.yawCandidates.map(y=>[y,allowed?proof.classes[y]:y])),
   reason:allowed?'exact mesh + collision + connectors; original yaw retained':indexed.has(p.id)?'explicit connector index':'no applicable symmetry proof',
   ...(allowed?{profileHash:proof.profileHash,sourceFiles:proof.sourceFiles,permutations:proof.permutations}:{})}
 })
 const byId=new Map(records.map(r=>[r.id,r]))
 const poseKey=p=>JSON.stringify([p.id,p.x,p.y,p.z,byId.get(p.id).classes[p.rotation]])
 return {records,poseKey}
}
// Only successful physical validation is reused. Preserve point order as the shared
// validator emits it: upper brick's ORIGINAL bottom connector array, not representative indices.
export function remapValidGeometry(geometry,bricks,rules){
 const byId=new Map(bricks.map(b=>[b.id,b]))
 return {...geometry,connections:geometry.connections.map(c=>{
  const bottom=rules.connectors(byId.get(c.upperId),'bottom')
  const index=p=>bottom.findIndex(b=>b.x/rules.STUD_LDU===p.x&&b.z/rules.STUD_LDU===p.z)
  if(c.points.some(p=>index(p)<0))throw Error('Symmetry connector permutation proof failed')
  return {...c,points:[...c.points].sort((a,b)=>index(a)-index(b))}
 })}
}
