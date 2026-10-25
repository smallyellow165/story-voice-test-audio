import { BrickViewer } from '../../src/brick-test/viewer'
import { PARTS, COLORS, validPosition } from '../../src/brick-test/catalog'
import { assessDesignDisplay } from '../../src/brick-design-display.mjs'
import { validateAssembly } from '../../src/brick-test/assembly'
const status = document.querySelector<HTMLDivElement>('#status')!
const report = document.querySelector<HTMLPreElement>('#report')!
const file = document.querySelector<HTMLInputElement>('#file')!
const viewer = new BrickViewer(document.querySelector<HTMLElement>('#scene')!, import.meta.env.BASE_URL + 'brick-ldraw/', message => { status.textContent = message })
document.querySelector('#fit')!.addEventListener('click', () => viewer.fit())
file.addEventListener('change', async () => {
  const selected = file.files?.[0]
  if (!selected) return
  file.disabled = true
  try {
    const candidate = JSON.parse(await selected.text())
    const display = assessDesignDisplay(candidate.design, { PARTS, COLORS, validPosition })
    if (!display.renderable) throw new Error(display.issues.join('; '))
    const geometry = validateAssembly(candidate.design.bricks)
    report.textContent = JSON.stringify({ currentGeometry: geometry, recordedReference: candidate.reference, recordedSupport: candidate.support, recordedHints: candidate.hints, recordedBuildOrder: candidate.buildOrder }, null, 2)
    if (!await viewer.replace(candidate.design.bricks)) throw new Error('本地零件加载失败，场景未完整应用。')
    status.textContent = '当前 Geometry: ' + (geometry.valid ? 'Valid' : 'Invalid') + ' · 记录的 Reference score: ' + candidate.reference?.score + ' · Build Order: ' + (candidate.buildOrder?.report?.valid ? 'Valid' : 'Invalid') + '；参考分数不是照片一致性证明。'
  } catch (e) { status.textContent = String(e) }
  finally { file.disabled = false }
})
window.addEventListener('pagehide', () => viewer.dispose(), { once: true })
