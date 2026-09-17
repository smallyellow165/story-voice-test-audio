/** Baseline reader for V4 Story fields, with an optional author-level sections extension. */
export type StoryItem = { type: 'narration'; text: string; audio?: { asset_id: string } } | { type: 'sound'; sound_id: string }
export type StorySection = { id: string; content: string; items?: StoryItem[]; media?: Record<string, unknown> }
export type StoryContent = StorySection & { title: string; age: string; summary: string; characters: string[]; tags: string[]; metadata?: Record<string, unknown>; sections: StorySection[] }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected content object')
  return value as Record<string, unknown>
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Expected nonempty content text')
  return value
}
function strings(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('Expected string list')
  return value.map(text)
}
function content(value: unknown): StorySection {
  const row = record(value)
  const result: StorySection = { id: text(row.id), content: text(row.content) }
  if (row.media != null) result.media = structuredClone(record(row.media))
  if (row.items !== undefined) {
    if (!Array.isArray(row.items) || !row.items.length) throw new Error('Expected nonempty items')
    result.items = row.items.map(value => {
      const item = record(value)
      if (item.type === 'sound') return { type: 'sound', sound_id: text(item.sound_id) }
      if (item.type !== 'narration') throw new Error('Unknown Story item type')
      return { type: 'narration', text: text(item.text), ...(item.audio != null ? { audio: { asset_id: text(record(item.audio).asset_id) } } : {}) }
    })
  }
  return result
}
export function loadStory(value: unknown): StoryContent {
  const row = record(value), base = content(row)
  const sections = row.sections === undefined ? [{ ...base, id: `${base.id}:whole` }] : (() => {
    if (!Array.isArray(row.sections) || !row.sections.length) throw new Error('Expected nonempty sections')
    return row.sections.map(content)
  })()
  if (new Set(sections.map(section => section.id)).size !== sections.length) throw new Error('Duplicate section id')
  return { ...base, title: text(row.title), age: text(row.age), summary: text(row.summary),
    characters: strings(row.characters), tags: strings(row.tags), sections,
    ...(row.metadata != null ? { metadata: structuredClone(record(row.metadata)) } : {}) }
}
export function sectionNarration(section: StorySection): string {
  return section.items ? section.items.filter(item => item.type === 'narration').map(item => item.text).join('\n') : section.content
}
// Content selection is independent of physical pages, markers and detection timing.
export function createStorySelection(story: StoryContent) {
  const source = structuredClone(story)
  let currentSection: string | null = null
  return {
    setCurrentSection(id: string) {
      if (!source.sections.some(section => section.id === id)) throw new Error('Unknown Story section')
      const changed = currentSection !== id; currentSection = id; return changed
    },
    read() { return currentSection === null ? null : structuredClone(source.sections.find(section => section.id === currentSection)!) },
    reset() { currentSection = null },
  }
}
