import {readFile,mkdir,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {sceneRegistrationFixture} from './magnetic-scene-registration-fixture.mjs'

/** Actual user-saved registered Combined v2. Never re-run registration or edit
 * the official record; all further operations use this disposable copy. */
export async function combinedFreeFixture(directory){
 const f=await sceneRegistrationFixture(directory)
 async function copy(file){const raw=await readFile(path.join(f.official,file),'utf8');f.copied.set(file,raw);await mkdir(path.dirname(path.join(directory,file)),{recursive:true});await writeFile(path.join(directory,file),raw);return JSON.parse(raw)}
 const id='combined-10013f06-675b-4bd0-9a11-e96fc79c1540'
 await copy(`assembly3d/${id}/000000000001.json`)
 const combined=await copy(`assembly3d/${id}/000000000002.json`)
 await copy('scene-registrations/'+combined.snapshot.photoOrigin.origin.sceneRegistration.id+'.json')
 const registry=await f.api.dispatch('GET','profiles'),large=registry.profiles.find(p=>p.id==='large-square'&&p.version===1)
 if(!large)throw Error('Missing exact saved large-square@1 Profile')
 const red=combined.snapshot.assembly.modules.find(m=>m.name==='red-pole'),roofId=red.pieces.find(p=>p.sourceId==='r10').id
 return {...f,combined,large,roofId}
}
