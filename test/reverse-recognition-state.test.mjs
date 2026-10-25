import test from 'node:test'
import assert from 'node:assert/strict'
import {recognitionBlockReason as reason} from '../src/brick-test/reverse-recognition-state.mjs'
const ready={busy:'',disabled:false,submitted:false,record:null,hasImage:true,modelAvailable:true,modelsReady:true,needsSession:false}
test('history is locked independently of prompt, never described as a running model call',()=>{
 for(const status of ['complete','failed','pending']){const text=reason({...ready,submitted:true,record:{status,id:'saved'}});assert.match(text,/历史 Analysis 已加载/);assert.match(text,/新建分析/);assert.doesNotMatch(text,/识别任务正在运行/)}
 assert.equal(reason(ready),'')
})
test('running, missing inputs and submitted-without-result have actionable distinct explanations',()=>{
 for(const [patch,expected] of [[{busy:'分析照片'},/识别任务正在运行/],[{busy:'准备图片'},/正在准备图片/],[{disabled:true},/其他操作/],[{modelsReady:false},/正在加载/],[{modelAvailable:false},/可用的 Provider/],[{hasImage:false},/选择或成功准备图片/],[{needsSession:true},/积木清单/],[{submitted:true},/尚未取得完整结果/]])assert.match(reason({...ready,...patch}),expected)
})
