import {readFile} from 'node:fs/promises'
export async function visibleFixture(name='right-angle'){
 const assembly=JSON.parse(await readFile(new URL('../src/magnetic-tiles/three-d/examples/'+name+'.json',import.meta.url),'utf8'))
 const evidence={version:1,observations:assembly.pieces.map((p,i)=>({id:p.id,color:p.color??'#55b8ac',bbox:[.05+i*.02,.1,.8,.9],features:[{id:'edge',points:[[.2,.3],[.5,.4]],visibility:'visible',note:'synthetic geometry test label, not a photograph recognition result'}],occlusion:i?'partially occluded in synthetic annotation':'none',evidence:'manually annotated visible test tile',uncertainty:'synthetic evidence fixture',profileCandidates:[{profileId:p.profileId,profileVersion:p.profileVersion,reason:'fixture reviewed dimensions'}]})),unknowns:['Fixture: no real photo accuracy claim']}
 const review={pieces:assembly.pieces.map(p=>({id:p.id,profileId:p.profileId,profileVersion:p.profileVersion,confirmed:true,excluded:false,color:p.color??'#55b8ac'})),constraints:[]}
 const input={evidence,review,profiles:assembly.profiles}
 const plan={version:1,parts:review.pieces.map(p=>({id:p.id,profileId:p.profileId,profileVersion:p.profileVersion,orientationEvidence:'synthetic fixture; no world frame calibration'})),connections:assembly.connections.map(c=>({pieceA:c.pieceA,pieceB:c.pieceB,portA:c.portA,portB:c.portB,intent:'connect',angles:[c.dihedralDeg],angleRange:null,flip:c.flip??false,evidenceRefs:[c.pieceA+':edge',c.pieceB+':edge'],evidence:'manual test connection',uncertainty:''})),alternatives:[],relations:[],unknowns:[]}
 return {assembly,evidence,review,input,plan}
}
export const png={mimeType:'image/png',imageBase64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lZ0AAAAASUVORK5CYII='}
