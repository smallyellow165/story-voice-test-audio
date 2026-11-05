export type AssemblyReference = {id:string;version:number;hash:string}
export const magneticGalleryUrl = () => import.meta.env.BASE_URL+'magnetic-gallery.html'
export const openGalleryItemUrl = (id:string) => magneticGalleryUrl()+'?'+new URLSearchParams({id})
export const addAssemblyToGalleryUrl = (ref:AssemblyReference) => magneticGalleryUrl()+'?'+new URLSearchParams({mode:'add',assemblyId:ref.id,version:String(ref.version),hash:ref.hash})

export const createMagneticWorkspaceUrl = () => import.meta.env.BASE_URL+'magnetic-tiles.html?workspace=create'
export const continueMagneticWorkspaceUrl = (id:string,stage:string) => import.meta.env.BASE_URL+'magnetic-tiles.html?'+new URLSearchParams({workspace:'create',workspaceId:id,stage})
export const editMagneticWorkspaceUrl = (id:string,ref:AssemblyReference) => import.meta.env.BASE_URL+'magnetic-tiles.html?'+new URLSearchParams({workspace:'edit',galleryId:id,assemblyId:ref.id,version:String(ref.version),hash:ref.hash,stage:'assembly'})
