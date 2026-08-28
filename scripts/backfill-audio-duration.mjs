import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { probeAudioDuration } from '../server/audio-duration.mjs'

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const generatedDirectory = path.join(projectRoot, 'generated')
const audioDirectory = path.join(generatedDirectory, 'test-audio')
const metadataFile = path.join(generatedDirectory, 'metadata.json')

const contents = await readFile(metadataFile, 'utf8')
const records = JSON.parse(contents)
if (!Array.isArray(records)) throw new Error('Generated audio metadata must be a JSON array.')

let updated = 0
let skipped = 0
let failed = 0
for (const record of records) {
  if (Number.isFinite(record.durationSeconds)) {
    skipped += 1
    continue
  }
  try {
    record.durationSeconds = await probeAudioDuration(path.join(audioDirectory, record.audioFile))
    updated += 1
  } catch (error) {
    failed += 1
    console.error(`Could not backfill ${record.id} (${record.audioFile}): ${error.message}`)
  }
}

if (updated > 0) await writeFile(metadataFile, `${JSON.stringify(records, null, 2)}\n`, 'utf8')
console.log(`Duration backfill: updated=${updated} skipped=${skipped} failed=${failed}`)
if (failed > 0) process.exitCode = 1
