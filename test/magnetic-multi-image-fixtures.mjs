import {readFile} from 'node:fs/promises'
import {createMagneticIntake} from '../server/magnetic-intake.mjs'
import {sourceImages} from '../src/magnetic-tiles/intake/image-set.ts'
import {upgradeVisibleFixture} from './magnetic-visible3d-v2-fixtures.mjs'
import {visibleFixture} from './magnetic-visible3d-fixtures.mjs'
export async function multiFixture(directory){
 const api=createMagneticIntake(directory),sources=[]
 for(const name of ['car-all.png','car-1.png','car-2.png','car-3.png']){const data=await readFile(new URL('../public/test-images/maganetic/'+name,import.meta.url)),image={mimeType:'image/png',imageBase64:data.toString('base64')};sources.push(await api.dispatch('POST','sources',{name,original:image,view:image}))}
 const images=sources.map((s,i)=>({...sourceImages(s)[0],origin:i%2?'upload':'server',role:i?'Step':'Final',direction:i?'Oblique':'Front',note:i?'Step state, not an additional tile set':'Target final construction'})),source=await api.dispatch('POST','source-sets',{images})
 const f=upgradeVisibleFixture(await visibleFixture());f.evidence.referenceImageId=source.primaryImageId
 for(const o of f.evidence.observations){o.imageEvidence=sources.map((s,i)=>({imageId:s.id,bbox:[.1+i*.1,.2,.45+i*.1,.7],features:[{...o.features[0],points:[[.1+i*.1,.2],[.45+i*.1,.2]]}],occlusion:'Partial frame evidence',evidence:'Synthetic matched-instance evidence across real image resources; not actual model recognition',uncertainty:'Cross-frame identity requires human review'}));o.bbox=o.imageEvidence[0].bbox;o.features=o.imageEvidence[0].features}
 const prepared={source,image:await api.dispatch('GET','image/'+source.id),images:await Promise.all(images.map(async e=>({...e,...await api.dispatch('GET','image/'+e.sourceId)}))),input:{source:{id:source.id,hash:source.hash},referenceImageId:source.primaryImageId,images:source.images,catalog:(await api.dispatch('GET','profiles')).profiles}}
 return {api,sources,images,source,prepared,...f}
}
