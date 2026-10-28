import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import ts from 'typescript'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {uiModuleUrl} from './ui-module.mjs'
import {parseExplorerScene} from '../src/brick-inventory/explorer-scene.mjs'
const {PartExplorerHeader}=await import(await uiModuleUrl(new URL('../src/brick-inventory/PartExplorerHeader.tsx',import.meta.url)))
test('title is a native same-path navigation that drops every parameter and hash on different deployments',()=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'location')
 try{for(const address of ['https://example.org/story-voice-test-audio/brick-inventory.html?strategy=assembled&imageSource=server&image=Penguin.png&analysisId=ed37d020-0a2c-4dd4-bb29-8c3aa93cbb68&provider=openai&unknown=x#review','https://example.org/nested/deploy/brick-inventory.html?mode=x#inventory','http://127.0.0.1:9999/brick-inventory.html?model=example']){
  const current=new URL(address);Object.defineProperty(globalThis,'location',{value:current,configurable:true})
  const html=renderToStaticMarkup(React.createElement(PartExplorerHeader)),href=html.match(/<a href="([^"]+)">LEGO Part Explorer<\/a>/)?.[1]
  assert.equal(href,current.pathname);const target=new URL(href,address);assert.equal(target.origin,current.origin);assert.equal(target.search,'');assert.equal(target.hash,'')
  const scene=parseExplorerScene(target.href);for(const key of ['strategy','analysisId','image','imageSource','provider','model'])assert.equal(scene[key],undefined)
  assert.match(html,/popover="auto"/);assert.match(html,/LEGO Part Explorer说明/)
  assert.ok(html.indexOf('IMAGE → RECOGNITION → MATCH')>html.indexOf('popover="auto"'))
  assert.doesNotMatch(html,/<nav|我的积木|AI Design Lab/)
 }}finally{if(previous)Object.defineProperty(globalThis,'location',previous);else delete globalThis.location}
})
function ast(source){return ts.createSourceFile('panel.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)}
function collect(node,predicate,result=[]){if(predicate(node))result.push(node);ts.forEachChild(node,n=>{collect(n,predicate,result)});return result}
test('native page navigation retains the actual dirty Review beforeunload cancellation guard',async()=>{
 const tree=ast(await readFile(new URL('../src/brick-test/ReverseAssemblyPanel.tsx',import.meta.url),'utf8'))
 const call=collect(tree,n=>ts.isCallExpression(n)&&n.expression.getText(tree)==='useEffect'&&n.getText(tree).includes("addEventListener('beforeunload'"))[0]
 const js=ts.transpileModule(call.getText(tree),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
 for(const dirty of [false,true]){let listener,cleanup;const window={addEventListener:(type,fn)=>{assert.equal(type,'beforeunload');listener=fn},removeEventListener:(type,fn)=>{assert.equal(listener,fn);listener=null}}
  Function('dirty','window','useEffect',js)(dirty,window,effect=>{cleanup=effect()})
  if(dirty){let prevented=false;const event={preventDefault:()=>{prevented=true}};listener(event);assert.equal(prevented,true);assert.equal(event.returnValue,'');cleanup();assert.equal(listener,null)}else assert.equal(listener,undefined)
 }
})
test('advanced controls remain mounted inside initially closed details; daily history and images stay outside',async()=>{
 for(const file of ['brick-test/ReverseAssemblyPanel.tsx','brick-vision/InventoryImagePanel.tsx']){
  const source=await readFile(new URL('../src/'+file,import.meta.url),'utf8'),tree=ast(source)
  const settings=collect(tree,n=>ts.isJsxElement(n)&&n.openingElement.tagName.getText(tree)==='details'&&n.openingElement.getText(tree).includes('recognition-settings'))
  assert.equal(settings.length,1);const section=settings[0]
  assert.ok(!section.openingElement.attributes.properties.some(a=>a.name?.getText(tree)==='open'))
  assert.match(section.getText(tree),/ModelSelector/);assert.match(section.getText(tree),/图片压缩/)
  assert.doesNotMatch(section.getText(tree),/ServerImagePicker|SourceImageHistoryFilter|SelectedAnalysis|WorkflowHistory/)
  if(file.includes('Reverse')){assert.match(section.getText(tree),/reverse-prompt-version/);assert.match(section.getText(tree),/Guided Re-analysis/);assert.match(section.getText(tree),/reverse-user-hint/)}
 }
})

test('loose Review also protects native navigation until saved',async()=>{
 const tree=ast(await readFile(new URL('../src/brick-vision/InventoryImagePanel.tsx',import.meta.url),'utf8'))
 const call=collect(tree,n=>ts.isCallExpression(n)&&n.expression.getText(tree)==='useEffect'&&n.getText(tree).includes("addEventListener('beforeunload'"))[0]
 const js=ts.transpileModule(call.getText(tree),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
 for(const [result,reviewSaved,expected] of [[null,false,false],[{id:'analysis'},true,false],[{id:'analysis'},false,true]]){
  let listener,cleanup;const window={addEventListener:(_,fn)=>{listener=fn},removeEventListener:()=>{listener=null}}
  Function('result','reviewSaved','window','useEffect',js)(result,reviewSaved,window,effect=>{cleanup=effect()})
  assert.equal(!!listener,expected)
  if(listener){let prevented=false;listener({preventDefault:()=>{prevented=true}});assert.equal(prevented,true);cleanup();assert.equal(listener,null)}
 }
})
