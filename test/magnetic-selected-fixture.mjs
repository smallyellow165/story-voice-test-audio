// Explicit choice in isolated tests, never a runtime fallback or history scan.
export async function selectFixture(api,sourceId,stage,record){
 const head=await api.dispatch('GET','visible3d/head/'+sourceId)
 return api.dispatch('POST','visible3d/selected',{sourceId,expectedRevision:head.selectedRevision??0,stage,id:record.id,hash:record.hash})
}
