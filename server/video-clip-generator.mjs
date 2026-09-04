import { access, mkdir, rename, stat, unlink } from 'node:fs/promises'
import { constants } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { buildFfmpegClipArgs } from '../src/video-clip.mjs'
import { VideoLibraryStorageError } from './video-library-repository.mjs'

const inFlightClipRanges = new Set()

const runFfmpeg = (args) => new Promise((resolve, reject) => {
  const process = spawn('ffmpeg', args, { shell: false, stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''
  process.stderr.setEncoding('utf8')
  process.stderr.on('data', (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-12_000)
  })
  process.on('error', (error) => {
    if (error?.code === 'ENOENT') {
      reject(new VideoLibraryStorageError('ffmpeg executable is unavailable on the server.', 'FFMPEG_UNAVAILABLE'))
      return
    }
    reject(error)
  })
  process.on('close', (code) => {
    if (code === 0) resolve()
    else reject(new VideoLibraryStorageError(
      `ffmpeg failed with exit code ${code}.${stderr.trim() ? ` ${stderr.trim()}` : ''}`,
      'FFMPEG_FAILED',
    ))
  })
})

const resolveSourcePath = async (video, sourceVideoDirectory) => {
  if (video.type !== 'server' || !video.server?.relativePath?.startsWith('source/')) {
    throw new VideoLibraryStorageError('Clip generation requires a server source video.', 'SOURCE_VIDEO_UNAVAILABLE')
  }
  const sourceRoot = path.resolve(sourceVideoDirectory)
  const sourcePath = path.resolve(path.dirname(sourceRoot), video.server.relativePath)
  if (!sourcePath.startsWith(`${sourceRoot}${path.sep}`)) {
    throw new VideoLibraryStorageError('Source video path is outside the source directory.', 'SOURCE_VIDEO_UNAVAILABLE')
  }
  try {
    await access(sourcePath, constants.R_OK)
  } catch {
    throw new VideoLibraryStorageError(`Source video does not exist: ${video.server.relativePath}`, 'SOURCE_VIDEO_NOT_FOUND')
  }
  return sourcePath
}

const outputFilenameFor = (video, clip) => {
  if (clip.generatedClip?.filename) return path.basename(clip.generatedClip.filename)
  if (typeof clip.outputFilename === 'string' && clip.outputFilename.toLowerCase().endsWith('.mp4')) {
    return path.basename(clip.outputFilename)
  }
  const extensionIndex = video.file.name.lastIndexOf('.')
  const baseName = extensionIndex > 0 ? video.file.name.slice(0, extensionIndex) : video.file.name
  const sequence = Math.max(1, video.nextClipNumber ?? 1)
  return `${baseName}-clip-${String(sequence).padStart(3, '0')}.mp4`
}

export const generateClip = async ({ clipRangeId, repository, sourceVideoDirectory, clipVideoDirectory }) => {
  if (typeof clipRangeId !== 'string' || !clipRangeId) {
    throw new VideoLibraryStorageError('clipRangeId is required.', 'INVALID_VIDEO_LIBRARY_SCHEMA')
  }
  if (inFlightClipRanges.has(clipRangeId)) {
    throw new VideoLibraryStorageError('This clip range is already being generated.', 'CLIP_GENERATION_IN_PROGRESS')
  }
  inFlightClipRanges.add(clipRangeId)
  let temporaryPath = ''
  let generatedOutputPath = ''
  let removeGeneratedOutputOnFailure = false
  try {
    const { video, clip } = await repository.findClipRange(clipRangeId)
    const sourcePath = await resolveSourcePath(video, sourceVideoDirectory)
    await mkdir(clipVideoDirectory, { recursive: true })
    const filename = outputFilenameFor(video, clip)
    const outputPath = path.join(clipVideoDirectory, filename)
    temporaryPath = path.join(
      clipVideoDirectory,
      `.${filename}.${globalThis.crypto.randomUUID()}.tmp.mp4`,
    )
    const duration = clip.end - clip.start
    const args = buildFfmpegClipArgs({
      start: clip.start,
      duration,
      inputPath: sourcePath,
      outputPath: temporaryPath,
    })
    await runFfmpeg(args)
    const outputStat = await stat(temporaryPath)
    if (!outputStat.isFile() || outputStat.size === 0) {
      throw new VideoLibraryStorageError('ffmpeg did not create a usable clip file.', 'FFMPEG_OUTPUT_MISSING')
    }
    await rename(temporaryPath, outputPath)
    temporaryPath = ''
    generatedOutputPath = outputPath
    removeGeneratedOutputOnFailure = !clip.generatedClip
    const generatedClip = {
      filename,
      relativePath: `clips/${filename}`,
      createdAt: new Date().toISOString(),
    }
    const library = await repository.attachGeneratedClip(clipRangeId, generatedClip)
    removeGeneratedOutputOnFailure = false
    return { library, generatedClip, ffmpegArgs: args.slice(0, -1).concat(outputPath) }
  } catch (error) {
    if (temporaryPath) await unlink(temporaryPath).catch(() => undefined)
    if (removeGeneratedOutputOnFailure && generatedOutputPath) {
      await unlink(generatedOutputPath).catch(() => undefined)
    }
    throw error
  } finally {
    inFlightClipRanges.delete(clipRangeId)
  }
}
