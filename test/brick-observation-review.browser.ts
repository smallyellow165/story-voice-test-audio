// Run manually in the real page after loading a saved History record and image.
// Exercises UI only: never clicks recognition, validation or inventory actions.
export async function auditBrickObservationReview() {
  const check = (value: boolean, reason: string) => { if (!value) throw new Error(reason) }
  const table = document.querySelector<HTMLTableElement>('.vision-observation-table')
  check(!!table, 'Load a successful History record first')
  check(document.querySelectorAll('.vision-observation-table').length === 1, 'Expected one unified observation table')
  const img = document.querySelector<HTMLImageElement>('.vision-preview-frame img')!
  check(!!img && img.complete && img.naturalWidth > 0, 'History preview must be loaded')
  const frame = img.parentElement!.getBoundingClientRect(), rect = img.getBoundingClientRect()
  check(Math.abs(frame.width - rect.width) < 1 && Math.abs(frame.height - rect.height) < 1, 'BBox frame must contain no letterboxing')
  check(Math.abs(rect.width / rect.height - img.naturalWidth / img.naturalHeight) < 0.01, 'Preview must preserve image aspect ratio')
  const toggle = document.querySelector<HTMLInputElement>('.vision-bbox-toggle input')!
  if (!toggle.checked) toggle.click()
  await new Promise(resolve => requestAnimationFrame(resolve))
  const boxes = [...document.querySelectorAll<HTMLButtonElement>('.vision-bbox')]
  check(boxes.length > 0, 'Expected valid BBoxes in this History record')
  boxes[0].click()
  await new Promise(resolve => requestAnimationFrame(resolve))
  const active = table!.querySelector<HTMLTableRowElement>('tr.is-active')!
  check(!!active && boxes[0].textContent === active.dataset.observationId, 'BBox must highlight the matching row')
  const id = table!.querySelector<HTMLButtonElement>('.vision-observation-id')!
  id.click()
  await new Promise(resolve => requestAnimationFrame(resolve))
  check(document.querySelector('.vision-bbox.is-active')?.textContent === id.textContent, 'Row must highlight its BBox')
  const row = id.closest('tr')!
  const details = [...row.querySelectorAll('button')].find(b => b.textContent === '详情')!
  details.click()
  await new Promise(resolve => requestAnimationFrame(resolve))
  const dialog = document.querySelector<HTMLDialogElement>('.vision-detail-modal')!
  check(!!dialog?.open, 'Details must open a native modal')
  const data = JSON.parse(dialog.querySelector('pre')!.textContent!)
  check(data.original.observation.id === id.textContent, 'Modal must show the original matching Observation')
  check('evidence' in data.original.observation && 'bbox' in data.original.observation && 'candidates' in data.original, 'Full evidence, geometry and Mapping must remain available')
  check([...dialog.querySelectorAll('button')].some(b => b.textContent === 'Copy JSON'), 'Copy JSON must remain available')
  dialog.querySelector<HTMLButtonElement>('header button')!.click()
  check(document.documentElement.scrollHeight <= innerHeight + 1, 'No page-level vertical scrollbar')
  return { passed: true, renderedBBoxes: boxes.length, observations: table!.tBodies[0].rows.length }
}
