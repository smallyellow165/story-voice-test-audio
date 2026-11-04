import test from 'node:test'
import assert from 'node:assert/strict'
import {libraryContents,libraryFolder} from '../src/magnetic-tiles/intake/library-browser.ts'
import {resolveIntakePreferences} from '../src/magnetic-tiles/studio-url.ts'
test('folder navigation is immediate-child only; search covers full paths globally without changing identity',()=>{
 const names=['root.png','car/front.png','castle/front.png','car/deep/side.jpg'],images=names.map(name=>({name,mimeType:'image/png'})),folders=['car','car/deep','castle','empty']
 assert.deepEqual(libraryContents(images,folders,'','').images.map(i=>i.name),['root.png'])
 assert.deepEqual(libraryContents(images,folders,'','').folders,['car','castle','empty'])
 assert.deepEqual(libraryContents(images,folders,'car','').images.map(i=>i.name),['car/front.png'])
 assert.deepEqual(libraryContents(images,folders,'car','').folders,['car/deep'])
 assert.deepEqual(libraryContents(images,folders,'car','FRONT').images.map(i=>i.name),['car/front.png','castle/front.png'])
 assert.deepEqual(libraryContents(images,folders,'castle','car/deep').images.map(i=>i.name),['car/deep/side.jpg'])
 assert.deepEqual(libraryContents(images,folders,'empty',''),{images:[],folders:[]})
 assert.equal(libraryFolder('root.png'),'');assert.equal(libraryFolder('car/front.png'),'car')
})
test('server images are the initial default; explicit source preferences and model resolution remain compatible',()=>{
 const config={models:[{id:'test-model',provider:'test'}],providers:{test:true}}
 assert.equal(resolveIntakePreferences('http://localhost/',null,config).sourceType,'server')
 assert.equal(resolveIntakePreferences('http://localhost/?sourceType=uploaded',null,config).sourceType,'uploaded')
 assert.equal(resolveIntakePreferences('http://localhost/',{sourceType:'uploaded',model:'test-model'},config).sourceType,'uploaded')
})
