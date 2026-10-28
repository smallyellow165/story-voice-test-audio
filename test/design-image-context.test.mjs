import test from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import {readFile} from 'node:fs/promises'
import {designImageContext,analysisInImage} from '../src/brick-test/design-image-context.ts'
import {historyForImage} from '../src/brick-vision/image-history.mjs'
const camel='sha256:'+'a'.repeat(64),penguin='sha256:'+'b'.repeat(64)
const records=[{id:'camel',sourceImageId:camel},...Array.from({length:4},(_,i)=>({id:'penguin'+i,sourceImageId:penguin}))]
const panel=new URL('../src/brick-test/SpatialAssemblyPanel.tsx',import.meta.url)
async function handler(name,context){
 const source=await readFile(panel,'utf8'),ast=ts.createSourceFile('panel.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
 let found;function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.text===name)found=n;ts.forEachChild(n,visit)}visit(ast);assert.ok(found)
 const js=ts.transpileModule(found.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
 return Function(...Object.keys(context),js+`;return ${name}`)(...Object.values(context))
}
test('explicit analysis resolves verified image; no context is all; explicit all survives reload',()=>{
 assert.equal(designImageContext(records,'camel').imageId,camel)
 assert.equal(designImageContext(records,'penguin0',penguin).imageId,penguin)
 assert.equal(historyForImage(records,penguin).length,4)
 assert.equal(designImageContext(records).imageId,'')
 assert.equal(designImageContext(records,'camel','').imageId,'')
 assert.equal(historyForImage(records,'').length,5)
 assert.equal(analysisInImage(records,penguin,'camel'),false)
})
test('conflicting or unverified identities cannot become current review inputs',()=>{
 assert.throws(()=>designImageContext(records,'camel',penguin),/不一致/)
 assert.throws(()=>designImageContext(records,'camel','sha256:'+'c'.repeat(64)),/未推断/)
 assert.throws(()=>designImageContext([{id:'old',name:'camel.png'}],'old'),/formal sourceImageId/)
 assert.equal(designImageContext(records,'old').analysisId,'')
 assert.match(designImageContext(records,'old').warning,/不能作为/)
 assert.throws(()=>designImageContext(records,'old',camel),/无法验证/)
})
test('image switch clears incompatible context only after confirmation; all retains current analysis',async()=>{
 const calls=[];let approved=false
 const ctx={gate:{current:false},disabled:false,sourceImageId:camel,analysisId:'camel',analyses:records,analysisInImage,allowContextSwitch:()=>approved,clearViewedContext:(...x)=>calls.push(['clear',...x]),setSourceImageId:x=>calls.push(['filter',x]),urlPatch:x=>calls.push(['url',x])}
 const change=await handler('filterImage',ctx)
 change(penguin);assert.deepEqual(calls,[])
 approved=true;change(penguin);assert.deepEqual(calls,[['clear','',penguin]])
 calls.length=0;change('');assert.deepEqual(calls,[['filter',''],['url',{sourceImageId:''}]])
 // No selection, preparation, generation or persistence dependencies are available.
})
test('analysis choice only reads selected analysis; cross-image selection is rejected',async()=>{
 const calls=[];let pending
 const change=await handler('chooseAnalysis',{gate:{current:false},disabled:false,analysisId:'',sourceImageId:camel,analyses:records,analysisInImage,setError:e=>calls.push(['error',e]),allowContextSwitch:()=>true,clearViewedContext:(...x)=>calls.push(['clear',...x]),action:f=>{pending=f()},refresh:async a=>calls.push(['history',a]),loadSource:async a=>calls.push(['review',a])})
 change('penguin0');assert.equal(calls[0][0],'error');calls.length=0
 change('camel');await pending;assert.deepEqual(calls,[['clear','camel',camel],['history','camel'],['review','camel']])
})
test('late spatial history response cannot repopulate a different image context',async()=>{
 let resolve;const response=new Promise(r=>resolve=r),calls=[],contextEpoch={current:0}
 const refresh=await handler('refresh',{analysisId:'camel',contextEpoch,request:()=>response,setPlans:v=>calls.push(v),setOperations:v=>calls.push(v)})
 const pending=refresh();contextEpoch.current++;resolve({items:['old']});await pending;assert.deepEqual(calls,[])
})
test('URL preserves deployment path and explicit all-images scope across refresh',async()=>{
 let result
 const patch=await handler('urlPatch',{location:{href:'https://example.test/nested/brick-test.html?analysisId=camel&sourceImageId=old&geometryId=old'},URL,window:{history:{replaceState:(_,__,u)=>result=u}}})
 patch({sourceImageId:'',geometryId:''});assert.equal(result.pathname,'/nested/brick-test.html');assert.equal(result.searchParams.get('sourceImageId'),'');assert.equal(result.searchParams.has('geometryId'),false)
 assert.equal(designImageContext(records,result.searchParams.get('analysisId'),result.searchParams.get('sourceImageId')).imageId,'')
})
test('review navigation carries exact image and analysis under deployment prefix; normal navigation stays plain',async()=>{
 async function hrefs(file,context){
  const source=await readFile(new URL('../src/brick-test/'+file,import.meta.url),'utf8'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),result=[]
  function visit(n){if(ts.isJsxAttribute(n)&&n.name.text==='href'&&n.initializer&&ts.isJsxExpression(n.initializer)){
   const expr=n.initializer.expression?.getText(ast)
   if(expr?.includes('brick-test.html?')||expr?.includes('brick-inventory.html'))result.push(Function(...Object.keys(context),'return '+expr.replaceAll('import.meta.env.BASE_URL',JSON.stringify('/nested/')))(...Object.values(context)))
  }ts.forEachChild(n,visit)}visit(ast);return result
 }
 const record={id:'camel',sourceImageId:camel},links=await hrefs('ReverseAssemblyPanel.tsx',{record,designSessionId:'session'})
 assert.equal(links.length,2)
 for(const href of links){const u=new URL(href,'https://example.test');assert.equal(u.pathname,'/nested/brick-test.html');assert.equal(u.searchParams.get('sourceImageId'),camel);assert.equal(u.searchParams.get('analysisId'),'camel')}
 // Use transpilation for the TypeScript non-null assertion in this actual JSX href.
 const source=await readFile(panel,'utf8')
 const expression=source.match(/href=\{(import.meta.env.BASE_URL\+'brick-inventory.html[^}]+)\}/)[1]
 const js=ts.transpileModule('const url='+expression.replace('import.meta.env.BASE_URL',JSON.stringify('/nested/')),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
 const href=Function('analysisId','analyses',js+';return url')('camel',records),u=new URL(href,'https://example.test')
 assert.equal(u.pathname,'/nested/brick-inventory.html');assert.equal(u.searchParams.get('analysisId'),'camel');assert.equal(u.searchParams.get('sourceImageId'),camel)
 const top=await readFile(new URL('../src/brick-test/BrickTestPage.tsx',import.meta.url),'utf8');assert.ok(top.includes('href={`${import.meta.env.BASE_URL}brick-inventory.html`}'))
})
