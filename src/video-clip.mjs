export const formatFfmpegTime = (seconds) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00:00.000'
  const totalMilliseconds = Math.round(seconds * 1000)
  const hours = Math.floor(totalMilliseconds / 3_600_000)
  const minutes = Math.floor((totalMilliseconds % 3_600_000) / 60_000)
  const wholeSeconds = Math.floor((totalMilliseconds % 60_000) / 1000)
  const milliseconds = totalMilliseconds % 1000
  return [hours, minutes, wholeSeconds]
    .map((value) => String(value).padStart(2, '0'))
    .join(':') + `.${String(milliseconds).padStart(3, '0')}`
}

export const quoteShellArgument = (value) => `"${value.replace(/[\\"$`]/g, '\\$&')}"`

export const buildFfmpegClipArgs = ({ start, duration, inputPath, outputPath }) => [
  '-ss', formatFfmpegTime(start),
  '-i', inputPath,
  '-t', formatFfmpegTime(duration),
  '-c:v', 'libx264',
  '-c:a', 'aac',
  outputPath,
]

export const buildFfmpegClipCommand = (options) => {
  const args = buildFfmpegClipArgs(options)
  return `ffmpeg ${args.map((argument, index) =>
    index === 3 || index === args.length - 1 ? quoteShellArgument(argument) : argument).join(' ')}`
}
