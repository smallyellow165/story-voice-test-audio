export const tile=(id,profileId='square',x=0,y=0,angleRad=0,color='#efc12e')=>({id,profileId,profileVersion:1,color,pose:{x,y,angleRad}})
const rotate=(tiles,a)=>tiles.map(t=>({...t,pose:{x:Math.cos(a)*t.pose.x-Math.sin(a)*t.pose.y,y:Math.sin(a)*t.pose.x+Math.cos(a)*t.pose.y,angleRad:t.pose.angleRad+a}}))
export const cases=[
 {id:'two-squares',tiles:[tile('a'),tile('b','square',1,0,0,'#df4139')]},
 {id:'square-right',tiles:[tile('a'),tile('b','right-triangle',0,1,0,'#df4139')]},
 {id:'house',tiles:[tile('a'),tile('b','square',1),tile('c','square',0,1),tile('d','square',1,1),tile('e','right-triangle',1,2,0,'#df4139'),tile('f','right-triangle',1,2,Math.PI/2,'#df4139')]},
 {id:'mixed',tiles:[tile('a'),tile('b','right-triangle',1,1,Math.PI,'#df4139'),tile('c','equilateral-triangle',0,1,0,'#4794cc')]},
 {id:'rotated-loop',tiles:rotate([tile('a'),tile('b','square',1),tile('c','square',0,1),tile('d','square',1,1)],.37)}
]
// Mixed: put right triangle below the square, sharing its bottom edge.
cases.find(c=>c.id==='mixed').tiles[1].pose={x:1,y:0,angleRad:Math.PI}
export function evidenceFor(tiles,profiles,vertices,validate){
 const points=tiles.flatMap(t=>vertices(t,profiles)),xs=points.map(p=>p[0]),ys=points.map(p=>p[1])
 const minX=Math.min(...xs)-.5,maxY=Math.max(...ys)+.5,width=(Math.max(...xs)-minX+.5)*180,height=(maxY-Math.min(...ys)+.5)*180
 const observations=tiles.map(t=>({id:t.id,profileId:t.profileId,profileVersion:1,color:t.color,outline:vertices(t,profiles).map(([x,y])=>[(x-minX)*180/width,(maxY-y)*180/height]),confidence:1,evidence:'ground-truth test fixture',uncertainty:'',origin:'observed',excluded:false}))
 return {width:Math.round(width),height:Math.round(height),evidence:{sourceKind:'diagram',reason:'test fixture',observations,relations:validate(tiles,profiles).connections.map(c=>({from:c.a.tileId,to:c.b.tileId,intent:'connect',evidence:'fixture contact'}))}}
}
