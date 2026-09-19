export type StoryAudioItem = { story_id: string; section_id: string; item_index: number; text: string; filename: string }
export function storyAudioItems(story: unknown): StoryAudioItem[]
