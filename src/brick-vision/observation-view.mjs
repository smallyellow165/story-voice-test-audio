// Display helpers only: never alter or infer identifiers, colors or geometry.
export function bboxStyle(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1)
    || bbox[0] >= bbox[2] || bbox[1] >= bbox[3]) return null
  return { left: `${bbox[0] * 100}%`, top: `${bbox[1] * 100}%`,
    width: `${(bbox[2] - bbox[0]) * 100}%`, height: `${(bbox[3] - bbox[1]) * 100}%` }
}

export function observationDescription(evidence) {
  if (typeof evidence !== 'string' || /可能|疑似|不确定|无法|也许|不是|并非|\b(?:not|maybe|unclear|or)\b/i.test(evidence)) return '—'
  const dimensions = [...new Set([...evidence.matchAll(/\b([1-9]\d*)\s*[x×]\s*([1-9]\d*)\b/gi)].map(m => `${m[1]}×${m[2]}`))]
  const colors = [...new Set(evidence.match(/(?:深|浅)?(?:蓝|红|黄|绿|橙|紫|粉|棕|灰|白|黑)色|\b(?:blue|red|yellow|green|orange|purple|pink|brown|gray|grey|white|black)\b/gi) || [])]
  if (dimensions.length > 1 || colors.length > 1) return '—'
  return dimensions.length || colors.length ? `${dimensions[0] || '—'} · ${colors[0] || '—'}` : '—'
}
