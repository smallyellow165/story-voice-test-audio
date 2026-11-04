export type LibraryImage={name:string;mimeType:string}
export const libraryFolder=(name:string)=>name.slice(0,Math.max(0,name.lastIndexOf('/')))
export const libraryBasename=(name:string)=>name.slice(name.lastIndexOf('/')+1)
export function libraryContents(images:readonly LibraryImage[],folders:readonly string[],folder:string,query:string){
 const term=query.trim().toLowerCase()
 return {
  images:images.filter(image=>term?image.name.toLowerCase().includes(term):libraryFolder(image.name)===folder),
  folders:term?[]:folders.filter(name=>libraryFolder(name)===folder),
 }
}
