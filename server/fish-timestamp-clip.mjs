import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { cleanAlignment, selectedAlignment } from '../src/fish-clean-alignment.mjs'
import { probeAudioDuration } from './audio-duration.mjs'
const exec = promisify(execFile)

export async function exportTimestampClip(body) {
  let clean, selection, bytes
  try {
    if (typeof body?.audio_base64 !== 'string' || !body.audio_base64.length ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.audio_base64)) throw new Error()
    bytes = Buffer.from(body.audio_base64, 'base64')
    if (bytes.length > 24 * 1024 * 1024) throw new Error()
    const input = body.alignment
    clean = cleanAlignment({ text: input.text, speed: input.speed, model: input.model,
      timeline: input.segments.map(s => ({ text: s.text, global_start: s.start, global_end: s.end })) },
    'source.mp3', input.duration)
    selection = selectedAlignment(clean, body.first, body.last, 'fish-selected-clip.mp3')
  } catch {
    throw Object.assign(new Error('Invalid audio, alignment or selected range.'), { statusCode: 400 })
  }
  const directory = await mkdtemp(path.join(tmpdir(), 'fish-clip-'))
  try {
    const source = path.join(directory, 'source.mp3'), target = path.join(directory, 'clip.mp3')
    await writeFile(source, bytes)
    const duration = await probeAudioDuration(source)
    if (selection.end > duration) throw Object.assign(new Error('Clip extends beyond audio duration.'), { statusCode: 400 })
    // Decode then trim samples, reset PTS, encode only selected audio. No padding/fades.
    await exec('ffmpeg', ['-v', 'error', '-nostdin', '-i', source, '-map', '0:a:0',
      '-af', `atrim=start=${selection.start}:end=${selection.end},asetpts=PTS-STARTPTS`,
      '-map_metadata', '-1', '-c:a', 'libmp3lame', '-b:a', '128k', target],
    { timeout: 30000, maxBuffer: 1024 * 1024 })
    const audio = await readFile(target)
    return { alignment: selection.alignment, audio_base64: audio.toString('base64'),
      format: 'audio/mpeg', source_start: selection.start, source_end: selection.end,
      encoded_duration: await probeAudioDuration(target) }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
