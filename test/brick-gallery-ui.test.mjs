import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import ts from 'typescript'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {uiModuleUrl} from './ui-module.mjs'
import {stepScene} from '../src/brick-build/plan.mjs'
const require=createRequire(import.meta.url)
const url=new URL('../src/brick-gallery/Gallery.tsx',import.meta.url)
let code=ts.transpileModule(await readFile(url,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText
code=code.replace(/import \{ useEffect, useRef, useState \} from 'react';/, 'const {useEffect,useRef,useState}=globalThis.galleryHooks;')
code=code.replace("import { BrickViewer } from '../brick-test/viewer';",'const BrickViewer=globalThis.galleryViewer;')
code=code.replace("'../brick-build/plan.mjs'",JSON.stringify(new URL('../src/brick-build/plan.mjs',import.meta.url).href))
code=code.replace("'../brick-vision/InfoHint'",JSON.stringify(await uiModuleUrl(new URL('../src/brick-vision/InfoHint.tsx',import.meta.url))))
code=code.replace(/import '.\/gallery.css';/,'').replaceAll('import.meta.env.BASE_URL',JSON.stringify('/nested/story-voice-test-audio/'))
code=code.replace('"react/jsx-runtime"',JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href))
let states=[],effects=[],calls=[]
globalThis.galleryHooks={useState(initial){return [states.length?states.shift():initial,()=>{}]},useRef(current){return {current}},useEffect(effect){effects.push(effect)}}
globalThis.galleryViewer=class{constructor(...args){calls.push(['construct',...args])}reset(){calls.push(['reset'])}dispose(){calls.push(['dispose'])}fit(){calls.push(['fit'])}async replace(bricks){calls.push(['replace',bricks]);return true}async prepareBuildStep(...args){calls.push(['prepare',...args]);return true}playBuildStep(){calls.push(['play'])}}
const {Gallery,GalleryModel,galleryUrl}=await import('data:text/javascript;base64,'+Buffer.from(code+'\nexport {GalleryModel}').toString('base64'))
const plan=JSON.parse(await readFile(new URL('../generated/brick-build-plans/426f27c7-a9a9-4ee9-9965-39e1cd9e30f8.json',import.meta.url)))
const source=JSON.parse(await readFile(new URL('../generated/brick-spatial-selections/77d99b0e-9c62-4ba6-b655-bcf1a8db5828.json',import.meta.url)))
const item={id:'gallery-example',title:'企鹅',description:'一起搭企鹅'}
const detail={item,source,plan,canBuild:true,brickCount:12,stepCount:11,parts:[{partNumber:'2302',name:'曲面积木',colorName:'Orange',colorHex:'#ff8800',quantity:1}]}
function render(mode,data=detail){globalThis.location={href:'http://example.test/nested/story-voice-test-audio/brick-gallery.html?id=gallery-example&mode='+mode};states=[[],[],data,'',false,0];effects=[];return renderToStaticMarkup(React.createElement(Gallery))}
test('detail and player URLs preserve deployment path and restore explicit saved item context',()=>{
 assert.equal(galleryUrl('a b','play'),'/nested/story-voice-test-audio/brick-gallery.html?id=a+b&mode=play')
 const html=render('detail');assert.match(html,/开始搭建/);assert.match(html,/mode=play/);assert.match(html,/2302/);assert.match(html,/12 块积木/)
 assert.doesNotMatch(render('detail',{...detail,plan:null,canBuild:false}),/开始搭建/)
 const player=render('play');assert.match(player,/第 1 步，共 11 步/);assert.match(player,/上一步/);assert.match(player,/下一步/);assert.match(player,/重播动画/);assert.doesNotMatch(player,/<input|<textarea|保存步骤|生成步骤|Add to Gallery/)
})
test('Gallery motion delegates exact saved step scenes to shared viewer and cancels on navigation',async()=>{
 for(const step of [0,5,10]){
  states=[];effects=[];calls=[]
  renderToStaticMarkup(React.createElement(GalleryModel,{source,plan,step}))
  const cleanups=effects.map(e=>e());await new Promise(resolve=>setImmediate(resolve))
  const expected=stepScene(plan,source.assembly.bricks,step),prepare=calls.find(c=>c[0]==='prepare')
  assert.deepEqual(prepare[1],expected.target);assert.deepEqual(prepare[2],expected.moving)
  assert.deepEqual(prepare[3],expected.step.motion||{offsetLdu:{x:0,y:120,z:0},startYawDegrees:0})
  assert.equal(calls.filter(c=>c[0]==='play').length,1)
  for(const cleanup of cleanups.reverse())cleanup?.()
  assert.equal(calls.filter(c=>c[0]==='dispose').length,1)
 }
})
test('full model uses exact saved assembly without generating or changing geometry',async()=>{
 states=[];effects=[];calls=[];renderToStaticMarkup(React.createElement(GalleryModel,{source}))
 const cleanups=effects.map(e=>e());await new Promise(resolve=>setImmediate(resolve))
 assert.deepEqual(calls.find(c=>c[0]==='replace')[1],source.assembly.bricks)
 assert.equal(calls.filter(c=>c[0]==='prepare').length,0)
 for(const cleanup of cleanups.reverse())cleanup?.()
})
test('reopening a Player reads its exact Gallery item; playback never posts or saves steps',async()=>{
 const oldFetch=globalThis.fetch,requests=[]
 globalThis.fetch=async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>detail}}
 try{
  render('play');const cleanups=effects.map(e=>e());await new Promise(resolve=>setImmediate(resolve))
  assert.deepEqual(requests,[{url:'/api/brick-gallery/items/gallery-example',options:{}}])
  for(const cleanup of cleanups.reverse())cleanup?.()
 }finally{globalThis.fetch=oldFetch}
})
