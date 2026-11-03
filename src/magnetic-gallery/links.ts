export type AssemblyReference = {id:string;version:number;hash:string}
export const magneticGalleryUrl = () => import.meta.env.BASE_URL+'magnetic-gallery.html'
export const openGalleryItemUrl = (id:string) => magneticGalleryUrl()+'?'+new URLSearchParams({id})
export const addAssemblyToGalleryUrl = (ref:AssemblyReference) => magneticGalleryUrl()+'?'+new URLSearchParams({mode:'add',assemblyId:ref.id,version:String(ref.version),hash:ref.hash})
