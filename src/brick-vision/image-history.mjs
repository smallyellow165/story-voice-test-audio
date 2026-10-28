// Views over canonical History records, not a second store. No guessed image associations.
export function imageHistoryGroups(records) {
  const groups = new Map()
  for (const record of records) {
    if (!/^sha256:[a-f0-9]{64}$/.test(record.sourceImageId || '')) throw Error('History record lacks a formal sourceImageId')
    groups.set(record.sourceImageId, (groups.get(record.sourceImageId) || 0) + 1)
  }
  return [...groups].map(([imageId, count]) => ({ imageId, count })).sort((a,b) => a.imageId.localeCompare(b.imageId))
}
export function historyForImage(records, imageId) {
  return imageId === '' ? records : records.filter(r => r.sourceImageId === imageId)
}
