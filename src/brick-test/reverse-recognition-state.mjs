// Explain the same guards used by the button; history is not a running request.
export function recognitionBlockReason({busy, disabled, submitted, record, hasImage, modelAvailable, modelsReady, needsSession}) {
  if (busy) return busy === '分析照片' ? '识别任务正在运行；完成后可查看结果，不会重复提交。' : `正在${busy}；完成后可继续操作。`
  if (disabled) return '当前页面有其他操作正在进行；请先完成该操作。'
  if (submitted && record) return `当前历史 Analysis 已加载（${record.status}，${record.id}）；如需使用所选 Prompt 重新识别，请先点击“新建分析 / 允许再次识别”。切换 Prompt 不会解除重复调用保护。`
  if (submitted) return '当前请求已提交，但尚未取得完整结果；请先查看错误或加载已有记录。确认需要再次识别时，点击“新建分析 / 允许再次识别”。'
  if (!modelsReady) return '正在加载 Provider / Model 列表。'
  if (!modelAvailable) return '尚未选择可用的 Provider / Model；请选择当前列表中的模型。'
  if (!hasImage) return '尚未选择或成功准备图片；请选择图片，并检查图片加载或压缩错误。'
  if (needsSession) return '尚未选择已保存积木清单；请先选择清单。'
  return ''
}
