import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

export function createStoryAudioStore(root, saveMp3) {
  let queue = Promise.resolve()
  return {
    save(asset, audio) {
      const operation = queue.then(async () => {
        const directory = path.join(root, asset.story_id)
        await mkdir(directory, { recursive: true })
        const manifestPath = path.join(directory, 'manifest.json')
        let manifest
        try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')) }
        catch (error) {
          if (error.code !== 'ENOENT') throw error
          manifest = { story_id: asset.story_id, assets: [] }
        }
        const durationSeconds = await saveMp3(path.join(directory, asset.filename), audio.audioContent)
        const entry = {
          section_id: asset.section_id, item_index: asset.item_index,
          text: asset.text, filename: asset.filename,
          provider: audio.provider, voice: audio.voice,
          ...(audio.model ? { model: audio.model } : {}),
        }
        manifest.assets = manifest.assets.filter((row) => row.filename !== asset.filename)
        manifest.assets.push(entry)
        const temporary = `${manifestPath}.tmp`
        await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`)
        await rename(temporary, manifestPath)
        return { durationSeconds, url: `/generated/story-audio/${encodeURIComponent(asset.story_id)}/${encodeURIComponent(asset.filename)}` }
      })
      queue = operation.catch(() => undefined)
      return operation
    },
  }
}

export function storyAudioPath(root, pathname) {
  const match = /^\/generated\/story-audio\/([A-Za-z0-9][A-Za-z0-9_-]*)\/([A-Za-z0-9][A-Za-z0-9_-]*\.mp3)$/.exec(pathname)
  return match ? path.join(root, match[1], match[2]) : null
}
