export type BatchRowStatus = 'Pending' | 'Downloading' | 'Clip' | 'Pose' | 'LLM' | 'Done' | 'Error'

export type BatchInputRow = {
  id: string
  label: string
  start: string
  end: string
  url: string
  status: BatchRowStatus
  error: string
}

export type ValidBatchInputRow = BatchInputRow & {
  label: string
  startSeconds: number
  endSeconds: number
  normalizedUrl: string
}

export type BatchValidationResult = {
  total: number
  uniqueSourceCount: number
  validCount: number
  invalidCount: number
  validRows: ValidBatchInputRow[]
  errorsByRowId: Map<string, string>
}

export const createBatchInputRow = (id: string, previous?: BatchInputRow): BatchInputRow => ({
  id,
  label: previous?.label ?? '',
  start: '',
  end: '',
  url: previous?.url ?? '',
  status: 'Pending',
  error: '',
})

const normalizeSourceUrl = (value: string) => {
  const parsed = new URL(value.trim())
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('URL must be HTTP or HTTPS.')
  }
  return parsed.href
}

export const validateBatchInputRows = (rows: BatchInputRow[]): BatchValidationResult => {
  const validRows: ValidBatchInputRow[] = []
  const errorsByRowId = new Map<string, string>()

  rows.forEach((row) => {
    const errors: string[] = []
    const label = row.label.trim()
    const startSeconds = Number(row.start)
    const endSeconds = Number(row.end)
    let normalizedUrl = ''

    if (!label) errors.push('Label is required.')
    if (!row.url.trim()) {
      errors.push('URL is required.')
    } else {
      try {
        normalizedUrl = normalizeSourceUrl(row.url)
      } catch (error) {
        errors.push(error instanceof Error ? error.message : 'URL is invalid.')
      }
    }
    if (!row.start.trim() || !Number.isFinite(startSeconds)) errors.push('Start must be a number.')
    else if (startSeconds < 0) errors.push('Start must be at least 0.')
    if (!row.end.trim() || !Number.isFinite(endSeconds)) errors.push('End must be a number.')
    else if (Number.isFinite(startSeconds) && endSeconds <= startSeconds) errors.push('End must be greater than Start.')

    if (errors.length) {
      errorsByRowId.set(row.id, errors.join(' '))
      return
    }
    validRows.push({ ...row, label, startSeconds, endSeconds, normalizedUrl })
  })

  return {
    total: rows.length,
    uniqueSourceCount: new Set(validRows.map((row) => row.normalizedUrl)).size,
    validCount: validRows.length,
    invalidCount: rows.length - validRows.length,
    validRows,
    errorsByRowId,
  }
}

export const findExistingSourceVideo = <T extends { sourceUrl?: string }>(videos: T[], normalizedUrl: string) =>
  videos.find((video) => video.sourceUrl === normalizedUrl)

export type BatchDatasetOperations<Source, Clip, Pose> = {
  resolveSource: (sourceUrl: string) => Promise<Source>
  createClip: (source: Source, row: ValidBatchInputRow) => Promise<Clip>
  generateClip: (source: Source, clip: Clip, row: ValidBatchInputRow) => Promise<Clip>
  analyzePose: (source: Source, clip: Clip, row: ValidBatchInputRow) => Promise<Pose>
  buildLlmPose: (source: Source, clip: Clip, pose: Pose, row: ValidBatchInputRow) => Promise<void>
}

export const processBatchDatasetRows = async <Source, Clip, Pose>(
  rows: ValidBatchInputRow[],
  operations: BatchDatasetOperations<Source, Clip, Pose>,
  onStatus: (rowId: string, status: BatchRowStatus, error?: string) => void,
) => {
  const groups = new Map<string, ValidBatchInputRow[]>()
  rows.forEach((row) => groups.set(row.normalizedUrl, [...(groups.get(row.normalizedUrl) ?? []), row]))
  let completed = 0

  for (const [sourceUrl, sourceRows] of groups) {
    sourceRows.forEach((row) => onStatus(row.id, 'Downloading'))
    let source: Source
    try {
      source = await operations.resolveSource(sourceUrl)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Source download failed.'
      sourceRows.forEach((row) => onStatus(row.id, 'Error', message))
      continue
    }

    for (const row of sourceRows) {
      try {
        onStatus(row.id, 'Clip')
        let clip = await operations.createClip(source, row)
        clip = await operations.generateClip(source, clip, row)
        onStatus(row.id, 'Pose')
        const pose = await operations.analyzePose(source, clip, row)
        onStatus(row.id, 'LLM')
        await operations.buildLlmPose(source, clip, pose, row)
        completed += 1
        onStatus(row.id, 'Done')
      } catch (error) {
        onStatus(row.id, 'Error', error instanceof Error ? error.message : 'Batch row processing failed.')
      }
    }
  }

  return { completed, failed: rows.length - completed }
}
