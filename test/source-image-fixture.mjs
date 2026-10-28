import path from 'node:path'
import { createSourceImageStore } from '../server/brick-source-images.mjs'
// Explicit synthetic ORIGINAL for isolated unit fixtures; never used by production code.
export const originalFixture = { width: 1, height: 1, mimeType: 'image/png', imageBase64: Buffer.from([137,80,78,71,13,10,26,10]).toString('base64') }
export async function sourceImageFixture(directory, original = originalFixture) {
  const source = await createSourceImageStore(path.join(directory, 'source-images')).put(original)
  return { sourceImageId: source.imageId, originalImage: original }
}
