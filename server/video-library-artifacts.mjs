import { rm, unlink } from 'node:fs/promises'
import path from 'node:path'
import { VideoLibraryStorageError } from './video-library-repository.mjs'

const resolveArtifact = (testVideoDirectory, videoId, relativePath) => {
  const videoRoot = path.resolve(testVideoDirectory, videoId)
  const fullPath = path.resolve(testVideoDirectory, relativePath)
  if (!/^video-\d{3,}$/.test(videoId) || !fullPath.startsWith(`${videoRoot}${path.sep}`)) {
    throw new VideoLibraryStorageError('Artifact path escaped its video directory.', 'INVALID_ARTIFACT_PATH')
  }
  return fullPath
}

const removeRecords = async (testVideoDirectory, records) => {
  const paths = [
    ...(records.clips ?? []).flatMap((item) => item.relativePath ? [[item.videoId, item.relativePath]] : []),
    ...(records.poseRuns ?? []).map((item) => [item.videoId, item.relativePath]),
    ...(records.llmPoseRuns ?? []).map((item) => [item.videoId, item.relativePath]),
  ]
  await Promise.all(paths.map(([videoId, relativePath]) =>
    unlink(resolveArtifact(testVideoDirectory, videoId, relativePath)).catch((error) => {
      if (error?.code !== 'ENOENT') throw error
    })))
}

export const deleteClipCascade = async ({ videoId, clipId, repository, testVideoDirectory }) => {
  const { library, result } = await repository.deleteClip(videoId, clipId)
  await removeRecords(testVideoDirectory, result)
  return library
}

export const deletePoseRunCascade = async ({ videoId, clipId, poseRunId, repository, testVideoDirectory }) => {
  const { library, result } = await repository.deletePoseRun(videoId, clipId, poseRunId)
  await removeRecords(testVideoDirectory, result)
  return library
}

export const deleteLlmPoseRunArtifact = async ({
  videoId,
  clipId,
  poseRunId,
  llmPoseRunId,
  repository,
  testVideoDirectory,
}) => {
  const { library, result } = await repository.deleteLlmPoseRun(videoId, clipId, poseRunId, llmPoseRunId)
  await removeRecords(testVideoDirectory, { llmPoseRuns: result })
  return library
}

export const deleteVideoCascade = async ({ videoId, repository, testVideoDirectory }) => {
  const { library } = await repository.deleteVideo(videoId)
  const videoDirectory = path.resolve(testVideoDirectory, videoId)
  const root = path.resolve(testVideoDirectory)
  if (!/^video-\d{3,}$/.test(videoId) || !videoDirectory.startsWith(`${root}${path.sep}`)) {
    throw new VideoLibraryStorageError('Video directory path is invalid.', 'INVALID_ARTIFACT_PATH')
  }
  await rm(videoDirectory, { recursive: true, force: true })
  return library
}
