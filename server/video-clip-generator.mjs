import { access, lstat, mkdir, realpath, rename, stat, unlink } from 'node:fs/promises'
import { constants } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { buildFfmpegClipArgs } from '../src/video-clip.mjs'
import { VideoLibraryStorageError } from './video-library-repository.mjs'

const inFlightClips = new Set()

const runFfmpeg = (args) => new Promise((resolve, reject) => {
  const process = spawn('ffmpeg', args, { shell: false, stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''
  process.stderr.setEncoding('utf8')
  process.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-12_000) })
  process.on('error', (error) => reject(error?.code === 'ENOENT'
    ? new VideoLibraryStorageError('ffmpeg executable is unavailable on the server.', 'FFMPEG_UNAVAILABLE')
    : error))
  process.on('close', (code) => code === 0 ? resolve() : reject(new VideoLibraryStorageError(
    `ffmpeg failed with exit code ${code}.${stderr.trim() ? ` ${stderr.trim()}` : ''}`,
    'FFMPEG_FAILED',
  )))
})

const resolveLibraryPath = (testVideoDirectory, relativePath, expectedDirectory) => {
  const root = path.resolve(testVideoDirectory)
  const expectedRoot = path.resolve(root, expectedDirectory)
  const fullPath = path.resolve(root, relativePath)
  if (!fullPath.startsWith(`${expectedRoot}${path.sep}`)) {
    throw new VideoLibraryStorageError('Artifact path is outside its source directory.', 'INVALID_ARTIFACT_PATH')
  }
  return { expectedRoot, fullPath }
}

export const resolveGeneratedClipFullPath = async ({ videoId, clipId, repository, testVideoDirectory }) => {
  const { clip } = await repository.findClip(videoId, clipId)
  if (!clip.relativePath) throw new VideoLibraryStorageError('Clip artifact does not exist.', 'CLIP_ARTIFACT_NOT_FOUND')
  const { expectedRoot, fullPath } = resolveLibraryPath(testVideoDirectory, clip.relativePath, `${videoId}/clips`)
  try {
    const [realRoot, realFile] = await Promise.all([realpath(expectedRoot), realpath(fullPath)])
    if (!realFile.startsWith(`${realRoot}${path.sep}`)) throw new Error('path escape')
    const fileStat = await stat(realFile)
    if (!fileStat.isFile()) throw new Error('not a file')
    return realFile
  } catch {
    throw new VideoLibraryStorageError(`Clip artifact does not exist: ${clip.relativePath}`, 'CLIP_ARTIFACT_NOT_FOUND')
  }
}

export const generateClip = async ({ videoId, clipId, repository, testVideoDirectory, run = runFfmpeg }) => {
  const actionKey = `${videoId}:${clipId}`
  if (inFlightClips.has(actionKey)) {
    throw new VideoLibraryStorageError('This clip is already being generated.', 'CLIP_GENERATION_IN_PROGRESS')
  }
  inFlightClips.add(actionKey)
  let temporaryPath = ''
  let backupPath = ''
  let outputPath = ''
  try {
    const { video, clip } = await repository.findClip(videoId, clipId)
    const source = resolveLibraryPath(testVideoDirectory, video.relativePath, videoId)
    try {
      await access(source.fullPath, constants.R_OK)
    } catch {
      throw new VideoLibraryStorageError(`Source video does not exist: ${video.relativePath}`, 'SOURCE_VIDEO_NOT_FOUND')
    }

    const clipsDirectory = path.join(testVideoDirectory, videoId, 'clips')
    await mkdir(clipsDirectory, { recursive: true })
    const filename = `${clipId}.mp4`
    outputPath = path.join(clipsDirectory, filename)
    temporaryPath = path.join(clipsDirectory, `.${filename}.${globalThis.crypto.randomUUID()}.tmp.mp4`)
    const args = buildFfmpegClipArgs({
      start: clip.startMs / 1000,
      duration: clip.durationMs / 1000,
      inputPath: source.fullPath,
      outputPath: temporaryPath,
    })
    await run(args)
    const outputStat = await stat(temporaryPath)
    if (!outputStat.isFile() || outputStat.size === 0) {
      throw new VideoLibraryStorageError('ffmpeg did not create a usable clip file.', 'FFMPEG_OUTPUT_MISSING')
    }
    try {
      const existing = await lstat(outputPath)
      if (existing.isDirectory()) throw new Error('output is a directory')
      backupPath = path.join(clipsDirectory, `.${filename}.${globalThis.crypto.randomUUID()}.backup`)
      await rename(outputPath, backupPath)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    await rename(temporaryPath, outputPath)
    temporaryPath = ''
    const relativePath = `${videoId}/clips/${filename}`
    try {
      const { library, result: storedClip } = await repository.attachClipArtifact(videoId, clipId, relativePath)
      if (backupPath) await unlink(backupPath).catch(() => undefined)
      backupPath = ''
      return { library, clip: storedClip, ffmpegArgs: args.slice(0, -1).concat(outputPath) }
    } catch (error) {
      await unlink(outputPath).catch(() => undefined)
      if (backupPath) await rename(backupPath, outputPath).catch(() => undefined)
      throw error
    }
  } finally {
    if (temporaryPath) await unlink(temporaryPath).catch(() => undefined)
    inFlightClips.delete(actionKey)
  }
}
