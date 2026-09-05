export type Point3 = [number, number, number]
export type PoseLandmarks = Point3[]
export type PoseClassification = Record<string, number>

export type PoseSample = {
  name: string
  landmarks: PoseLandmarks
  className: string
  embedding: PoseLandmarks
}

export type PoseSampleOutlier = {
  sample: PoseSample
  detectedClasses: string[]
  allClasses: PoseClassification
}

export type PoseCsvFile = {
  fileName: string
  contents: string
}

export type RawImageLandmark = {
  x: number
  y: number
  z: number
  visibility?: number
  presence?: number
}

export type RawPoseFrame = {
  videoTimestampMs: number
  landmarks: RawImageLandmark[][]
  worldLandmarks?: RawImageLandmark[][]
}

const LANDMARK_NAMES = [
  'nose',
  'left_eye_inner', 'left_eye', 'left_eye_outer',
  'right_eye_inner', 'right_eye', 'right_eye_outer',
  'left_ear', 'right_ear',
  'mouth_left', 'mouth_right',
  'left_shoulder', 'right_shoulder',
  'left_elbow', 'right_elbow',
  'left_wrist', 'right_wrist',
  'left_pinky_1', 'right_pinky_1',
  'left_index_1', 'right_index_1',
  'left_thumb_2', 'right_thumb_2',
  'left_hip', 'right_hip',
  'left_knee', 'right_knee',
  'left_ankle', 'right_ankle',
  'left_heel', 'right_heel',
  'left_foot_index', 'right_foot_index',
] as const

const landmarkIndex = new Map(LANDMARK_NAMES.map((name, index) => [name, index]))

const requireLandmarkIndex = (name: typeof LANDMARK_NAMES[number]) => {
  const index = landmarkIndex.get(name)
  if (index === undefined) throw new Error(`Unknown pose landmark: ${name}`)
  return index
}

const copyLandmarks = (landmarks: ReadonlyArray<Readonly<Point3>>): PoseLandmarks =>
  landmarks.map((landmark) => [landmark[0], landmark[1], landmark[2]])

const assertPoseLandmarks = (landmarks: ReadonlyArray<Readonly<Point3>>) => {
  if (landmarks.length !== LANDMARK_NAMES.length) {
    throw new Error(`Unexpected number of landmarks: ${landmarks.length}`)
  }
  landmarks.forEach((landmark, index) => {
    if (landmark.length !== 3 || landmark.some((value) => !Number.isFinite(value))) {
      throw new Error(`Landmark ${index} must contain three finite coordinates.`)
    }
  })
}

const average = (from: Readonly<Point3>, to: Readonly<Point3>): Point3 => [
  (from[0] + to[0]) * 0.5,
  (from[1] + to[1]) * 0.5,
  (from[2] + to[2]) * 0.5,
]

const distance = (from: Readonly<Point3>, to: Readonly<Point3>): Point3 => [
  to[0] - from[0],
  to[1] - from[1],
  to[2] - from[2],
]

export class FullBodyPoseEmbedder {
  readonly torsoSizeMultiplier: number

  constructor(torsoSizeMultiplier = 2.5) {
    this.torsoSizeMultiplier = torsoSizeMultiplier
  }

  embed(landmarks: ReadonlyArray<Readonly<Point3>>): PoseLandmarks {
    assertPoseLandmarks(landmarks)
    return this.getPoseDistanceEmbedding(this.normalizePoseLandmarks(landmarks))
  }

  normalizePoseLandmarks(landmarks: ReadonlyArray<Readonly<Point3>>): PoseLandmarks {
    assertPoseLandmarks(landmarks)
    const normalized = copyLandmarks(landmarks)
    const poseCenter = this.getPoseCenter(normalized)
    normalized.forEach((landmark) => {
      landmark[0] -= poseCenter[0]
      landmark[1] -= poseCenter[1]
      landmark[2] -= poseCenter[2]
    })
    const poseSize = this.getPoseSize(normalized)
    normalized.forEach((landmark) => {
      landmark[0] = landmark[0] / poseSize * 100
      landmark[1] = landmark[1] / poseSize * 100
      landmark[2] = landmark[2] / poseSize * 100
    })
    return normalized
  }

  private getPoseCenter(landmarks: ReadonlyArray<Readonly<Point3>>): Point3 {
    return average(
      landmarks[requireLandmarkIndex('left_hip')],
      landmarks[requireLandmarkIndex('right_hip')],
    )
  }

  private getPoseSize(landmarks: ReadonlyArray<Readonly<Point3>>) {
    const leftHip = landmarks[requireLandmarkIndex('left_hip')]
    const rightHip = landmarks[requireLandmarkIndex('right_hip')]
    const hipsX = (leftHip[0] + rightHip[0]) * 0.5
    const hipsY = (leftHip[1] + rightHip[1]) * 0.5
    const leftShoulder = landmarks[requireLandmarkIndex('left_shoulder')]
    const rightShoulder = landmarks[requireLandmarkIndex('right_shoulder')]
    const shouldersX = (leftShoulder[0] + rightShoulder[0]) * 0.5
    const shouldersY = (leftShoulder[1] + rightShoulder[1]) * 0.5
    const torsoSize = Math.hypot(shouldersX - hipsX, shouldersY - hipsY)

    // The Extended Colab deliberately computes pose size from X/Y only.
    const poseCenterX = hipsX
    const poseCenterY = hipsY
    const maxDistance = Math.max(...landmarks.map((landmark) =>
      Math.hypot(landmark[0] - poseCenterX, landmark[1] - poseCenterY)))
    return Math.max(torsoSize * this.torsoSizeMultiplier, maxDistance)
  }

  private getAverageByNames(
    landmarks: ReadonlyArray<Readonly<Point3>>,
    from: typeof LANDMARK_NAMES[number],
    to: typeof LANDMARK_NAMES[number],
  ) {
    return average(landmarks[requireLandmarkIndex(from)], landmarks[requireLandmarkIndex(to)])
  }

  private getDistanceByNames(
    landmarks: ReadonlyArray<Readonly<Point3>>,
    from: typeof LANDMARK_NAMES[number],
    to: typeof LANDMARK_NAMES[number],
  ) {
    return distance(landmarks[requireLandmarkIndex(from)], landmarks[requireLandmarkIndex(to)])
  }

  private getPoseDistanceEmbedding(landmarks: ReadonlyArray<Readonly<Point3>>): PoseLandmarks {
    return [
      distance(
        this.getAverageByNames(landmarks, 'left_hip', 'right_hip'),
        this.getAverageByNames(landmarks, 'left_shoulder', 'right_shoulder'),
      ),
      this.getDistanceByNames(landmarks, 'left_shoulder', 'left_elbow'),
      this.getDistanceByNames(landmarks, 'right_shoulder', 'right_elbow'),
      this.getDistanceByNames(landmarks, 'left_elbow', 'left_wrist'),
      this.getDistanceByNames(landmarks, 'right_elbow', 'right_wrist'),
      this.getDistanceByNames(landmarks, 'left_hip', 'left_knee'),
      this.getDistanceByNames(landmarks, 'right_hip', 'right_knee'),
      this.getDistanceByNames(landmarks, 'left_knee', 'left_ankle'),
      this.getDistanceByNames(landmarks, 'right_knee', 'right_ankle'),
      this.getDistanceByNames(landmarks, 'left_shoulder', 'left_wrist'),
      this.getDistanceByNames(landmarks, 'right_shoulder', 'right_wrist'),
      this.getDistanceByNames(landmarks, 'left_hip', 'left_ankle'),
      this.getDistanceByNames(landmarks, 'right_hip', 'right_ankle'),
      this.getDistanceByNames(landmarks, 'left_hip', 'left_wrist'),
      this.getDistanceByNames(landmarks, 'right_hip', 'right_wrist'),
      this.getDistanceByNames(landmarks, 'left_shoulder', 'left_ankle'),
      this.getDistanceByNames(landmarks, 'right_shoulder', 'right_ankle'),
      // These duplicates are present in the source-of-truth Extended Colab.
      this.getDistanceByNames(landmarks, 'left_hip', 'left_wrist'),
      this.getDistanceByNames(landmarks, 'right_hip', 'right_wrist'),
      this.getDistanceByNames(landmarks, 'left_elbow', 'right_elbow'),
      this.getDistanceByNames(landmarks, 'left_knee', 'right_knee'),
      this.getDistanceByNames(landmarks, 'left_wrist', 'right_wrist'),
      this.getDistanceByNames(landmarks, 'left_ankle', 'right_ankle'),
    ]
  }
}

const parseCsvRows = (contents: string) => {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < contents.length; index += 1) {
    const character = contents[index]
    if (quoted) {
      if (character === '"' && contents[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (character === '"') quoted = false
      else field += character
    } else if (character === '"') quoted = true
    else if (character === ',') {
      row.push(field)
      field = ''
    } else if (character === '\n') {
      row.push(field.replace(/\r$/, ''))
      rows.push(row)
      row = []
      field = ''
    } else field += character
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field.')
  if (field || row.length) {
    row.push(field.replace(/\r$/, ''))
    rows.push(row)
  }
  return rows.filter((fields) => fields.length !== 1 || fields[0] !== '')
}

export const loadPoseSamplesFromCsvFiles = (
  files: ReadonlyArray<PoseCsvFile>,
  poseEmbedder = new FullBodyPoseEmbedder(),
) => {
  const poseSamples: PoseSample[] = []
  files.forEach(({ fileName, contents }) => {
    if (!fileName.endsWith('.csv')) return
    const className = fileName.slice(0, -4)
    parseCsvRows(contents).forEach((row, rowIndex) => {
      if (row.length !== 100) {
        throw new Error(`${fileName}:${rowIndex + 1} has ${row.length} values; expected 100.`)
      }
      const values = row.slice(1).map((value, valueIndex) => {
        const parsed = Math.fround(Number(value))
        if (!Number.isFinite(parsed)) {
          throw new Error(`${fileName}:${rowIndex + 1} coordinate ${valueIndex + 1} is not numeric.`)
        }
        return parsed
      })
      const landmarks: PoseLandmarks = Array.from({ length: 33 }, (_, landmarkIndexValue) => [
        values[landmarkIndexValue * 3],
        values[landmarkIndexValue * 3 + 1],
        values[landmarkIndexValue * 3 + 2],
      ])
      poseSamples.push({
        name: row[0],
        landmarks,
        className,
        embedding: poseEmbedder.embed(landmarks),
      })
    })
  })
  return poseSamples
}

type PoseClassifierOptions = {
  topNByMaxDistance?: number
  topNByMeanDistance?: number
  axesWeights?: Point3
}

export class PoseClassifier {
  readonly samples: PoseSample[]
  readonly poseEmbedder: FullBodyPoseEmbedder
  readonly topNByMaxDistance: number
  readonly topNByMeanDistance: number
  readonly axesWeights: Point3

  constructor(
    samples: ReadonlyArray<PoseSample>,
    poseEmbedder = new FullBodyPoseEmbedder(),
    options: PoseClassifierOptions = {},
  ) {
    this.samples = [...samples]
    this.poseEmbedder = poseEmbedder
    this.topNByMaxDistance = options.topNByMaxDistance ?? 30
    this.topNByMeanDistance = options.topNByMeanDistance ?? 10
    this.axesWeights = options.axesWeights ?? [1, 1, 0.2]
  }

  static fromCsvFiles(
    files: ReadonlyArray<PoseCsvFile>,
    poseEmbedder = new FullBodyPoseEmbedder(),
    options: PoseClassifierOptions = {},
  ) {
    return new PoseClassifier(loadPoseSamplesFromCsvFiles(files, poseEmbedder), poseEmbedder, options)
  }

  classify(poseLandmarks: ReadonlyArray<Readonly<Point3>>): PoseClassification {
    assertPoseLandmarks(poseLandmarks)
    const poseEmbedding = this.poseEmbedder.embed(poseLandmarks)
    const flippedPoseEmbedding = this.poseEmbedder.embed(
      poseLandmarks.map((landmark) => [-landmark[0], landmark[1], landmark[2]]),
    )

    const maxDistances = this.samples.map((sample, sampleIndex) => ({
      sampleIndex,
      distance: Math.min(
        this.maxWeightedDistance(sample.embedding, poseEmbedding),
        this.maxWeightedDistance(sample.embedding, flippedPoseEmbedding),
      ),
    }))
    maxDistances.sort((left, right) => left.distance - right.distance)

    const meanDistances = maxDistances.slice(0, this.topNByMaxDistance).map(({ sampleIndex }) => {
      const sample = this.samples[sampleIndex]
      return {
        sampleIndex,
        distance: Math.min(
          this.meanWeightedDistance(sample.embedding, poseEmbedding),
          this.meanWeightedDistance(sample.embedding, flippedPoseEmbedding),
        ),
      }
    })
    meanDistances.sort((left, right) => left.distance - right.distance)

    const result: PoseClassification = {}
    meanDistances.slice(0, this.topNByMeanDistance).forEach(({ sampleIndex }) => {
      const className = this.samples[sampleIndex].className
      result[className] = (result[className] ?? 0) + 1
    })
    return result
  }

  findPoseSampleOutliers(): PoseSampleOutlier[] {
    return this.samples.flatMap((sample) => {
      const allClasses = this.classify(copyLandmarks(sample.landmarks))
      const counts = Object.values(allClasses)
      const maxCount = counts.length ? Math.max(...counts) : Number.NEGATIVE_INFINITY
      const detectedClasses = Object.keys(allClasses).filter((className) => allClasses[className] === maxCount)
      return detectedClasses.includes(sample.className) && detectedClasses.length === 1
        ? []
        : [{ sample, detectedClasses, allClasses }]
    })
  }

  private coordinateDistances(left: PoseLandmarks, right: PoseLandmarks) {
    return left.flatMap((landmark, landmarkIndexValue) => landmark.map((value, axis) =>
      Math.abs(value - right[landmarkIndexValue][axis]) * this.axesWeights[axis]))
  }

  private maxWeightedDistance(left: PoseLandmarks, right: PoseLandmarks) {
    return Math.max(...this.coordinateDistances(left, right))
  }

  private meanWeightedDistance(left: PoseLandmarks, right: PoseLandmarks) {
    const distances = this.coordinateDistances(left, right)
    return distances.reduce((sum, value) => sum + value, 0) / distances.length
  }
}

export class EMADictSmoothing {
  readonly windowSize: number
  readonly alpha: number
  private dataInWindow: PoseClassification[] = []

  constructor(windowSize = 10, alpha = 0.2) {
    this.windowSize = windowSize
    this.alpha = alpha
  }

  smooth(data: PoseClassification): PoseClassification {
    this.dataInWindow.unshift({ ...data })
    this.dataInWindow = this.dataInWindow.slice(0, this.windowSize)
    const keys = new Set(this.dataInWindow.flatMap((item) => Object.keys(item)))
    const smoothedData: PoseClassification = {}
    keys.forEach((key) => {
      let factor = 1
      let topSum = 0
      let bottomSum = 0
      this.dataInWindow.forEach((item) => {
        topSum += factor * (item[key] ?? 0)
        bottomSum += factor
        factor *= 1 - this.alpha
      })
      smoothedData[key] = topSum / bottomSum
    })
    return smoothedData
  }
}

export class RepetitionCounter {
  readonly className: string
  readonly enterThreshold: number
  readonly exitThreshold: number
  private poseEnteredValue = false
  private repeats = 0

  constructor(className: string, enterThreshold = 6, exitThreshold = 4) {
    this.className = className
    this.enterThreshold = enterThreshold
    this.exitThreshold = exitThreshold
  }

  get nRepeats() {
    return this.repeats
  }

  get poseEntered() {
    return this.poseEnteredValue
  }

  count(poseClassification: PoseClassification) {
    const poseConfidence = poseClassification[this.className] ?? 0
    if (!this.poseEnteredValue) {
      this.poseEnteredValue = poseConfidence > this.enterThreshold
      return this.repeats
    }
    if (poseConfidence < this.exitThreshold) {
      this.repeats += 1
      this.poseEnteredValue = false
    }
    return this.repeats
  }
}

export const rawPoseFrameToClassifierLandmarks = (
  frame: RawPoseFrame,
  frameWidth: number,
  frameHeight: number,
  poseIndex = 0,
): PoseLandmarks | null => {
  if (!Number.isFinite(frameWidth) || frameWidth <= 0 || !Number.isFinite(frameHeight) || frameHeight <= 0) {
    throw new Error('Frame width and height must be positive finite numbers.')
  }
  const imageLandmarks = frame.landmarks[poseIndex]
  if (!imageLandmarks) return null
  if (imageLandmarks.length !== 33) {
    throw new Error(`Unexpected number of Raw Pose image landmarks: ${imageLandmarks.length}`)
  }
  return imageLandmarks.map((landmark, index) => {
    if (![landmark.x, landmark.y, landmark.z].every(Number.isFinite)) {
      throw new Error(`Raw Pose image landmark ${index} has invalid coordinates.`)
    }
    // Match the Extended Colab's np.float32 image-space representation.
    return [
      Math.fround(landmark.x * frameWidth),
      Math.fround(landmark.y * frameHeight),
      Math.fround(landmark.z * frameWidth),
    ]
  })
}
