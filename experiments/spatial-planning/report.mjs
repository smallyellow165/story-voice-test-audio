const escape = v => String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;')
const json = v => '<pre>'+escape(JSON.stringify(v,null,2))+'</pre>'
export function renderReport(record) {
  const plan = record.plan
  const parts = record.validation?.valid ? plan.parts : []
  const image = record.image
  const overlay = parts.map((p,i) => {
    const b=p.image.bbox
    if (!b) return ''
    return '<rect x="'+b[0]*1000+'" y="'+b[1]*1000+'" width="'+(b[2]-b[0])*1000+'" height="'+(b[3]-b[1])*1000+'" fill="none" stroke="hsl('+i*51+' 90% 40%)" stroke-width="3"/><text x="'+b[0]*1000+'" y="'+Math.max(18,b[1]*1000-5)+'" fill="black" stroke="white" stroke-width="2" paint-order="stroke" font-size="21">'+escape(p.id)+'</text>'
  }).join('')
  const photo = image && /^image\/(jpeg|png|webp)$/.test(image.mimeType) && /^[A-Za-z0-9+/]+={0,2}$/.test(image.imageBase64)
    ? '<div class="photo"><img alt="原始参考照片" src="data:'+image.mimeType+';base64,'+image.imageBase64+'"><svg viewBox="0 0 1000 1000" preserveAspectRatio="none">'+overlay+'</svg></div>' : ''
  const rows = parts.map(p => '<tr><td>'+escape(p.id)+'<br>'+escape(p.role)+'</td><td>'+escape(p.pose.relativeTo ?? '(anchor)')+json(p.pose.offsetLdu)+'</td><td>'+json({yaw:p.pose.yawCandidates,upright:p.pose.upright,confidence:p.pose.confidence,unknowns:p.pose.unknowns})+'</td><td>'+escape(p.pose.evidence)+json(p.image)+'</td><td>'+json(p.connections)+'</td></tr>').join('')
  return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Spatial Planning V1</title><style>body{font:16px system-ui;margin:24px;color:#182433;background:#fafafa}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:12px;vertical-align:top;text-align:left}td{min-width:140px}.photo{position:relative;max-width:600px}.photo img{display:block;width:100%}.photo svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}.scroll{overflow:auto}summary{cursor:pointer;margin-top:20px}h1{font-size:25px}</style><h1>Spatial Assembly Planning V1</h1><p>状态：'+escape(record.status)+' · Trace '+escape(record.id)+' · '+escape(record.model)+'</p><p>这是模型的空间假设。格式通过不代表照片理解正确；Geometry / Build Order 未运行，也没有自动修正。</p>'+photo+
    '<h2>人工验收（不发送给模型）</h2><p>核对七个身份完整且无重复；两块薄件均在身体、上下分层且水平错位；双腿在身体下且分离；颈在一端、头在颈上、背砖在身体上。对照轮廓和接缝检查偏移，隐藏接口应保留不确定性。</p>'+
    '<h2>空间实例</h2><p>图片框来自第二阶段模型。偏移单位 LDU，原点为零件底部中心，坐标轴在 scene 中解释。</p><div class="scroll"><table><thead><tr><th>身份 / 角色</th><th>参考 / 偏移范围</th><th>朝向 / 不确定性</th><th>图片证据</th><th>连接意图</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
    '<h2>Scene / 相对关系</h2>'+json({scene:plan?.scene,relations:plan?.relations,alternatives:plan?.alternatives})+
    '<h2>格式与转换诊断</h2>'+json({parseStatus:record.parseStatus,validation:record.validation,conversion:record.conversion,error:record.error})+
    '<details><summary>原始模型文本（未经修正）</summary><pre>'+escape(record.rawOutput)+'</pre></details>'+
    '<details><summary>结构化解析结果（包括无效结果）</summary>'+json(plan)+'</details>'+
    '<details><summary>已确认输入、尺寸和来源</summary>'+json(record.requestInput)+json(record.sources)+'</details>'+
    '<details><summary>Trace 路径 / 设置 / Usage</summary>'+json({trace:record.tracePath,request:record.rawRequestPath,response:record.rawResponsePath,settings:record.generationSettings,usage:record.usageMetadata,wireStatus:record.wireStatus})+'</details></html>'
}
