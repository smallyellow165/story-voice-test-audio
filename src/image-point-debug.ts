import './image-point-debug.css'

type Point = { x: number, y: number }

const fileInput = document.querySelector<HTMLInputElement>('#image-file')!
const image = document.querySelector<HTMLImageElement>('#image')!
const imageStage = document.querySelector<HTMLDivElement>('#image-stage')!
const emptyImage = document.querySelector<HTMLParagraphElement>('#empty-image')!
const pointLayer = document.querySelector<HTMLDivElement>('#point-layer')!
const imageSize = document.querySelector<HTMLParagraphElement>('#image-size')!
const pointsList = document.querySelector<HTMLOListElement>('#points')!
const status = document.querySelector<HTMLParagraphElement>('#status')!
const undoButton = document.querySelector<HTMLButtonElement>('#undo')!
const clearButton = document.querySelector<HTMLButtonElement>('#clear')!
const copyButton = document.querySelector<HTMLButtonElement>('#copy-points')!

let imageUrl: string | undefined
let points: Point[] = []

function renderPoints() {
  pointLayer.replaceChildren()
  pointsList.replaceChildren()
  points.forEach((point, index) => {
    const marker = document.createElement('span')
    marker.className = 'point-marker'
    marker.textContent = String(index + 1)
    marker.style.left = `${(point.x / image.naturalWidth) * 100}%`
    marker.style.top = `${(point.y / image.naturalHeight) * 100}%`
    pointLayer.append(marker)

    const item = document.createElement('li')
    item.textContent = `${index + 1}: x=${point.x}, y=${point.y}`
    pointsList.append(item)
  })
  const hasPoints = points.length > 0
  undoButton.disabled = !hasPoints
  clearButton.disabled = !hasPoints
  copyButton.disabled = !hasPoints
}

function clearPoints() {
  points = []
  renderPoints()
}

function pointText() {
  return points.map((point, index) => `${index + 1}: x=${point.x}, y=${point.y}`).join('\n')
}

async function copyPoints() {
  try {
    await navigator.clipboard.writeText(pointText())
    status.textContent = 'Points copied to clipboard.'
  } catch {
    status.textContent = 'Could not copy points. Your browser may block clipboard access.'
  }
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0]
  if (!file) return
  if (!['image/jpeg', 'image/png'].includes(file.type)) {
    status.textContent = 'Please choose a JPG or PNG image.'
    return
  }
  URL.revokeObjectURL(imageUrl ?? '')
  imageUrl = URL.createObjectURL(file)
  clearPoints()
  image.src = imageUrl
  status.textContent = 'Loading image…'
})

image.addEventListener('load', () => {
  imageStage.hidden = false
  emptyImage.hidden = true
  imageSize.textContent = `Original: ${image.naturalWidth} × ${image.naturalHeight}`
  status.textContent = 'Click the image to add points in original-image coordinates.'
  renderPoints()
})

image.addEventListener('click', (event) => {
  const bounds = image.getBoundingClientRect()
  if (!image.naturalWidth || !image.naturalHeight || !bounds.width || !bounds.height) return
  const x = Math.min(image.naturalWidth - 1, Math.max(0, Math.round((event.clientX - bounds.left) * image.naturalWidth / bounds.width)))
  const y = Math.min(image.naturalHeight - 1, Math.max(0, Math.round((event.clientY - bounds.top) * image.naturalHeight / bounds.height)))
  points.push({ x, y })
  status.textContent = `Point ${points.length}: x=${x}, y=${y} (original image).`
  renderPoints()
})

undoButton.addEventListener('click', () => {
  points.pop()
  status.textContent = 'Last point removed.'
  renderPoints()
})
clearButton.addEventListener('click', () => {
  clearPoints()
  status.textContent = 'All points cleared.'
})
copyButton.addEventListener('click', () => void copyPoints())
window.addEventListener('pagehide', () => URL.revokeObjectURL(imageUrl ?? ''), { once: true })
