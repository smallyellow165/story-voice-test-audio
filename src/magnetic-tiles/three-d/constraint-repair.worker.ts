import {findConstraintRepairs} from './constraint-repair.ts'
import type {Assembly3D} from './assembly.ts'
import type {AngleHintSource} from './assembly-angle-hints.ts'
import type {RepairOptions} from './constraint-repair.ts'
self.onmessage=(event:MessageEvent<{assembly:Assembly3D;source:AngleHintSource;targets?:string[];options:RepairOptions}>)=>{
 try{const {assembly,source,targets,options}=event.data;self.postMessage({result:findConstraintRepairs(assembly,source,targets,options,(checks,nodes)=>self.postMessage({progress:{checks,nodes}}))})}
 catch(e){self.postMessage({error:String(e)})}
}
