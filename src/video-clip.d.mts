export type FfmpegClipOptions = {
  start: number
  duration: number
  inputPath: string
  outputPath: string
}

export function formatFfmpegTime(seconds: number): string
export function quoteShellArgument(value: string): string
export function buildFfmpegClipArgs(options: FfmpegClipOptions): string[]
export function buildFfmpegClipCommand(options: FfmpegClipOptions): string
