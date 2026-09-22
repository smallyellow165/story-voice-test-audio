// Pure conversion shared by the debug page and clip exporter. Times are seconds.
export function cleanAlignment(result, audio, duration) {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Invalid audio duration.')
  const segments = result.timeline.map((segment, index) => ({
    index, text: segment.text, start: segment.global_start, end: segment.global_end,
  }))
  let previous = -Infinity
  for (const segment of segments) {
    if (typeof segment.text !== 'string' || !Number.isFinite(segment.start) ||
        !Number.isFinite(segment.end) || segment.start < 0 || segment.end < segment.start ||
        segment.start < previous || segment.end > duration) throw new Error('Invalid segment timing.')
    previous = segment.start
  }
  return { text: result.text, speed: result.speed, model: result.model, audio, segments, duration }
}

export function selectedAlignment(clean, first, last, audio) {
  if (!Number.isInteger(first) || !Number.isInteger(last) || first < 0 ||
      last < first || last >= clean.segments.length) throw new Error('Start char must be <= End char within the available segments.')
  const selected = clean.segments.slice(first, last + 1)
  const start = selected[0].start, end = selected.at(-1).end
  if (end <= start || selected.some(s => s.start < start || s.end > end)) throw new Error('Selected range has invalid or zero duration.')
  const relative = value => Number((value - start).toFixed(9))
  return { start, end, alignment: {
    text: selected.map(s => s.text).join(''), speed: clean.speed, model: clean.model, audio,
    segments: selected.map((s, index) => ({ index, text: s.text, start: relative(s.start), end: relative(s.end) })),
    duration: relative(end),
  } }
}
