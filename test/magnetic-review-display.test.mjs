import test from 'node:test'
import assert from 'node:assert/strict'
import {normalizeReviewDisplay,reviewDisplayDefaults,observationImageIds,imageFilteredIds,preferredReviewImage,filteredReviewRows} from '../src/magnetic-tiles/intake/review-display.ts'
const observations=[
 {id:'p01',profileId:'square',profileVersion:1,excluded:false,color:'#abcdef',confidence:.9,outline:[],evidence:'roof',uncertainty:'',origin:'observed',imageEvidence:[{imageId:'final'},{imageId:'step1'}]},
 {id:'p03',profileId:'unknown',profileVersion:1,excluded:false,color:'#abcdef',confidence:.4,outline:[],evidence:'ramp',uncertainty:'partly hidden',origin:'observed',imageEvidence:[{imageId:'step1'},{imageId:'step2'}]},
 {id:'p10',profileId:'square',profileVersion:1,excluded:true,color:'#abcdef',confidence:.8,outline:[],evidence:'excluded proof retained',uncertainty:'',origin:'observed',imageEvidence:[{imageId:'final'}]},
]
test('image filters use OR and unique Observation ID rows, independently of confirmation or exclusion',()=>{
 assert.deepEqual(imageFilteredIds(observations,['final'],'final'),['p01','p10'])
 assert.deepEqual(imageFilteredIds(observations,['step2'],'final'),['p03'])
 assert.deepEqual(imageFilteredIds(observations,['final','step1'],'final'),['p01','p03','p10'])
 assert.deepEqual(imageFilteredIds(observations,[],'final'),[])
 assert.deepEqual(observationImageIds({id:'legacy'},'ref'),['ref'])
 assert.deepEqual(imageFilteredIds([{id:'legacy'}],['alternate'],'ref'),[])
})
test('image, status, search and sorting compose without mutating full Recognition/Review data',()=>{
 const before=structuredClone(observations),ids=imageFilteredIds(observations,['final','step1'],'final'),defaults=reviewDisplayDefaults()
 assert.deepEqual(filteredReviewRows(observations,ids,{...defaults,filter:'Known'}).map(o=>o.id),['p01'])
 assert.deepEqual(filteredReviewRows(observations,ids,{...defaults,filter:'Excluded'}).map(o=>o.id),['p10'])
 assert.deepEqual(filteredReviewRows(observations,ids,{...defaults,filter:'Unknown',query:'RAMP'}).map(o=>o.id),['p03'])
 assert.deepEqual(filteredReviewRows(observations,ids,{...defaults,query:'正方形'},()=> '正方形').map(o=>o.id),['p01','p03','p10'])
 assert.deepEqual(filteredReviewRows(observations,ids,{...defaults,sort:'confidence'}).map(o=>o.id),['p03','p10','p01'])
 assert.deepEqual(observations,before)
})
test('only current analysis IDs are restored; empty images and no marks remain distinct from all images',()=>{
 const saved={imageIds:['final','foreign','final'],markedIds:['p01','foreign','p01'],query:'roof',filter:'Known',sort:'id',confirmed:true,excluded:true}
 const normalized=normalizeReviewDisplay(saved,['final','step1'],['p01','p03'])
 assert.deepEqual(normalized,{imageIds:['final'],markedIds:['p01'],query:'roof',filter:'Known',sort:'id'})
 assert.deepEqual(normalizeReviewDisplay(null,['final'],['p01']),reviewDisplayDefaults())
 assert.deepEqual(normalizeReviewDisplay({imageIds:[],markedIds:[]},['final'],['p01']).imageIds,[])
 assert.equal(normalizeReviewDisplay({imageIds:null},['final'],['p01']).imageIds,null)
 assert.equal(normalizeReviewDisplay({filter:'approved',sort:'world_pose'},[],[]).filter,'All')
})
test('row selection prefers evidence in an already selected image and never changes the image filter set',()=>{
 const images=['final','step2'],before=[...images]
 assert.equal(preferredReviewImage(observations[1],images,'final','final'),'step2')
 assert.equal(preferredReviewImage(observations[0],images,'final','final'),'final')
 assert.equal(preferredReviewImage(observations[1],['final'],'final','final'),'final','no selected proof: keep current photo without inventing annotations')
 assert.deepEqual(images,before)
})
test('display state supports future image counts without changing Canonical limits or retaining unknown IDs',()=>{
 const ids=Array.from({length:80},(_,i)=>'image'+i),o={id:'tile',imageEvidence:ids.map(imageId=>({imageId}))}
 assert.deepEqual(normalizeReviewDisplay({imageIds:ids},ids,['tile']).imageIds,ids)
 assert.deepEqual(imageFilteredIds([o],ids,'image0'),['tile'])
})
