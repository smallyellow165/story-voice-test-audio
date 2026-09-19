// Read the existing Story JSON directly; never rebuild or renumber its items.
export function storyAudioItems(story) {
  const validId = (value) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)
  if (!story || !validId(story.id) || !Array.isArray(story.sections)) {
    throw new Error('Expected a Story object with id and sections. IDs must use letters, numbers, underscores or hyphens.')
  }
  const sections = new Set()
  const assets = []
  for (const section of story.sections) {
    if (!section || !validId(section.id) || sections.has(section.id) || !Array.isArray(section.items)) {
      throw new Error('Each section needs a unique safe id and its original items array.')
    }
    sections.add(section.id)
    section.items.forEach((item, index) => {
      if (item?.type !== 'narration') return
      if (typeof item.text !== 'string' || !item.text.trim()) throw new Error('Narration text must not be empty.')
      assets.push({
        story_id: story.id,
        section_id: section.id,
        item_index: index + 1,
        text: item.text,
        filename: `${story.id}__${section.id}__item-${index + 1}.mp3`,
      })
    })
  }
  if (!assets.length) throw new Error('Story has no TTS narration items.')
  return assets
}
