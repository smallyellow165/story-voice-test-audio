export async function intakeApi<T>(route: string, body?: unknown): Promise<T> {
  const response = await fetch('/api/magnetic-intake/'+route, body === undefined ? undefined : { method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body) })
  let data
  try { data = await response.json() } catch { throw Error('Image Intake 需要 Test Audio 服务：请用 npm run dev 启动，不能只启动 Vite。') }
  if(!response.ok)throw Error(data.error || `HTTP ${response.status}`)
  return data
}
const base64 = (blob: Blob): Promise<string> => new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=()=>reject(Error('无法读取图片'));r.readAsDataURL(blob)})
export async function prepareImage(file: File) {
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>6*1024*1024||!file.size)throw Error('请选择不超过 6 MB 的 PNG/JPEG/WebP')
  const bitmap=await createImageBitmap(file,{imageOrientation:'from-image'})
  try {
    if(bitmap.width*bitmap.height>40_000_000)throw Error('原图像素过大，请先缩小')
    const scale=Math.min(1,1536/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas')
    canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale)
    const ctx=canvas.getContext('2d');if(!ctx)throw Error('无法建立图片视图')
    ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height)
    const png=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('PNG 编码失败')),'image/png'))
    if(png.size>6*1024*1024)throw Error('识别视图超过 6 MB，请缩小原图')
    return {name:file.name,original:{mimeType:file.type,imageBase64:await base64(file)},view:{mimeType:'image/png',imageBase64:await base64(png)}}
  }finally{bitmap.close()}
}

// Reuse the same browser decoder, orientation and PNG view preparation as upload.
export async function prepareLibraryImage(name: string) {
  const image=await intakeApi<{name:string;mimeType:string;imageBase64:string}>('library-image',{name})
  const bytes=Uint8Array.from(atob(image.imageBase64),c=>c.charCodeAt(0))
  return prepareImage(new File([bytes],image.name,{type:image.mimeType}))
}
