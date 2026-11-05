/** Small dense robust least squares, matching the offline soft_l1 objective.
 * Only the optimizer is implemented here; camera/residuals retain that model. */
export function linearSolve(a:number[][],b:number[]):number[]{
 const m=a.map((r,i)=>[...r,b[i]]),n=b.length
 for(let j=0;j<n;j++){
  let k=j;for(let i=j+1;i<n;i++)if(Math.abs(m[i][j])>Math.abs(m[k][j]))k=i
  if(Math.abs(m[k][j])<1e-14)throw Error('空间证据退化，无法确定配准')
  ;[m[j],m[k]]=[m[k],m[j]];const v=m[j][j];for(let c=j;c<=n;c++)m[j][c]/=v
  for(let i=0;i<n;i++)if(i!==j){const s=m[i][j];for(let c=j;c<=n;c++)m[i][c]-=s*m[j][c]}
 }
 return m.map(r=>r[n])
}
const cost=(r:number[])=>r.reduce((s,x)=>s+4*(Math.sqrt(1+(x/2)**2)-1),0)
export function leastSquares(fn:(p:number[])=>number[],initial:number[],valid:(p:number[])=>boolean,iterations=180){
 let p=[...initial],r=fn(p),c=cost(r),lambda=.001
 for(let it=0;it<iterations;it++){
  const n=p.length,cols=p.map((v,j)=>{const h=1e-5*Math.max(1,Math.abs(v)),q=[...p];q[j]+=h;const next=fn(q);return next.map((x,i)=>(x-r[i])/h)}),a=Array.from({length:n},()=>Array(n).fill(0)),b=Array(n).fill(0)
  for(let i=0;i<r.length;i++){const w=1/Math.sqrt(1+(r[i]/2)**2);for(let j=0;j<n;j++){b[j]-=cols[j][i]*w*r[i];for(let k=0;k<n;k++)a[j][k]+=cols[j][i]*w*cols[k][i]}}
  let improved=false
  for(let trial=0;trial<12;trial++){
   const damped=a.map((row,j)=>row.map((v,k)=>v+(j===k?lambda*Math.max(a[j][j],1e-6):0)))
   const delta=linearSolve(damped,b),q=p.map((v,j)=>v+delta[j]),rr=valid(q)?fn(q):null,cc=rr?cost(rr):Infinity
   if(cc<c){const gain=c-cc;p=q;r=rr!;c=cc;lambda=Math.max(1e-10,lambda/3);improved=true;if(gain<1e-8)return {p,cost:c};break}
   lambda*=5
  }
  if(!improved)break
 }
 return {p,cost:c}
}
