import {canonical} from './build-plan.ts'
import type {Assembly} from './geometry.ts'
import type {BuildBundle} from './build-plan.ts'
import {bundleFor} from './build-storage.ts'
import type {BuildLibrary} from './build-storage.ts'
export function buildHistory(library:BuildLibrary){
 return [library.preview,...[...(library.retainedPreviews??[])].reverse(),...[...library.plans].reverse().map(p=>bundleFor(library,p.id))].filter((b):b is BuildBundle=>!!b)
}
// Exact snapshot identity, revision and contents. Same name or a global activeId
// never proves that a tutorial belongs to the selected work/version.
export function matchingBuild(library:BuildLibrary,source:Assembly|undefined){
 if(!source)return null
 return buildHistory(library).find(b=>canonical(b.snapshot.assembly)===canonical(source))??null
}
export function buildSaveState(library:BuildLibrary,bundle:BuildBundle|null){
 if(!bundle)return 'none' as const
 const saved=library.plans.find(p=>p.id===bundle.plan.id)
 if(!saved)return 'unsaved' as const
 return canonical(bundleFor(library,saved.id))===canonical(bundle)?'saved' as const:'different' as const
}
