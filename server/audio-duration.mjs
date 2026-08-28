import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const probeAudioDuration = async (audioPath) => {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      audioPath,
    ], { encoding: 'utf8', maxBuffer: 1024 * 1024 })
    const durationSeconds = Number.parseFloat(stdout.trim())
    if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
      throw new Error(`ffprobe returned an invalid duration: ${stdout.trim() || '(empty output)'}`)
    }
    return durationSeconds
  } catch (error) {
    throw new Error(`ffprobe could not read duration for ${audioPath}: ${error.message}`, { cause: error })
  }
}
