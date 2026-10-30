// Navigate the production Studio UI; no runtime state injection.
export async function stage(page,id,column='workspace'){
 if(id==='catalog'){await rightTab(page,'catalog');return}
 const tab=page.locator(`[data-stage="${id}"]`)
 await tab.waitFor({state:'attached'})
 if(!await tab.isVisible())await page.getByRole('button',{name:'工作阶段',exact:true}).filter({visible:true}).click()
 if(await tab.getAttribute('aria-current')!=='step')await tab.click()
 if((page.viewportSize()?.width??1500)<=760){
  const target=page.locator(`.studio-${column}`)
  if(!await target.isVisible()){
   const name=column==='inspector'?'检查器':'工作区'
   const short=page.getByRole('button',{name,exact:true}).filter({visible:true})
   if(await short.count())await short.click()
   else await page.getByRole('button',{name:column==='inspector'?'查看检查器':'查看工作区',exact:true}).click()
  }
 }
 if(column==='inspector')await rightTab(page,'inspector')
}
export async function rightTab(page,tab){
 const pane=page.locator('.studio-inspector')
 if(!await pane.isVisible()){
  const short=page.getByRole('button',{name:'检查器',exact:true}).filter({visible:true})
  if(await short.count())await short.click();else await page.getByRole('button',{name:'查看检查器',exact:true}).filter({visible:true}).click()
 }
 await page.getByRole('tab',{name:tab==='catalog'?'Tiles Catalog':'Inspector',exact:true}).click()
}
const build=new Set(['生成搭建步骤','保存教程','导出教程 JSON','导入教程 JSON','打开教程','下一步','上一步','重播当前步','重新开始','完成搭建'])
const center=new Set(['新建','撤销','适合画布','放大视图','缩小视图'])
const assembly=new Set(['保存作品快照','加载所选作品','导出 JSON','导入 JSON','旋转 90°','翻面选中','↷ 15°','↶ 15°','删除选中'])
export function studioButton(page,name){
 const locator=page.getByRole('button',{name,exact:true})
 return new Proxy(locator,{get(target,prop){const value=target[prop];if(typeof value!=='function')return value
  if(!['click','waitFor','isDisabled'].includes(String(prop)))return value.bind(target)
  return async(...args)=>{if(['click','waitFor','isDisabled'].includes(String(prop))){if(['识别图片（调用模型）','上传磁力片图片','刷新 Server Library'].includes(name))await stage(page,'source','inspector');else if(build.has(name))await stage(page,'build','inspector');else if(['保存审核快照','新增零件'].includes(name))await stage(page,'review','workspace');else if(['设置关系'].includes(name))await stage(page,'review','inspector');else if(name==='生成几何重建'||name==='在作品编辑器中打开')await stage(page,'reconstruction','inspector');else if(center.has(name)||assembly.has(name)||name.startsWith('添加'))await stage(page,'assembly',center.has(name)?'workspace':'inspector')}
   return value.apply(target,args)
  }
 }})
}

// Review fields stay available in collapsed sections; tests use the visible UI.
export async function reviewDetails(page,name){
 await stage(page,'review','inspector')
 const summary=page.getByText(name,{exact:true})
 if(!await summary.evaluate(el=>el.parentElement.open))await summary.click()
}
