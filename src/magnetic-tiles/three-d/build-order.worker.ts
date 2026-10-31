import { generateBuildOrder3D } from './build-order.ts'
import type { Assembly3D } from './assembly.ts'
import type { BuildOrderOptions } from './build-order.ts'
self.onmessage=(event:MessageEvent<{request:number;assembly:Assembly3D;options:BuildOrderOptions}>)=>{
  try{self.postMessage({request:event.data.request,result:generateBuildOrder3D(event.data.assembly,event.data.options)})}
  catch(error){self.postMessage({request:event.data.request,error:String(error)})}
}
