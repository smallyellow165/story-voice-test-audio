// Browser-only acceptance assertions against the real Inventory page.
// Import manually after opening the page; no server, fixtures or model calls.
export function auditBrickInventoryLayout() {
  const check = (condition: boolean, message: string) => {
    if (!condition) throw new Error(message)
  }
  const page = document.querySelector<HTMLElement>('.inventory-workbench')
  check(!!page, 'Inventory workbench must be mounted')
  const panels = [...page!.querySelectorAll<HTMLElement>('.three-column-layout__panel')]
  check(panels.length === 3, 'Expected three independently scrollable panels')
  check(page!.matches('[data-group]'), 'Workbench root must be the resizable group itself')
  check(document.getElementById('brick-inventory-root')?.firstElementChild === page, 'No independent page regions outside the group')
  const header = page!.querySelector('header')
  check(!!header && panels[0].contains(header), 'Complete page header must be inside Source')
  check(panels[0].querySelector('.three-column-layout__content')?.firstElementChild === header, 'Header must precede Source controls')
  check(!!header?.querySelector('h1') && header.querySelectorAll('nav a').length === 2, 'Title and both navigation links must remain')
  check(document.documentElement.scrollHeight <= window.innerHeight + 1, 'Document has vertical overflow')
  check(document.body.scrollHeight <= window.innerHeight + 1, 'Body has vertical overflow')
  check(document.documentElement.scrollWidth <= window.innerWidth + 1, 'Document has horizontal overflow')
  const pageRect = page!.getBoundingClientRect()
  check(pageRect.top >= -1 && pageRect.bottom <= window.innerHeight + 1, 'Workbench exceeds viewport')
  for (const panel of panels) {
    const style = getComputedStyle(panel)
    check(['auto', 'scroll'].includes(style.overflowY), 'Each panel must own vertical scrolling')
    check(panel.clientHeight > 0, 'Panel must have a bounded nonzero height')
    check(Math.abs(panel.getBoundingClientRect().top) <= 1, 'Panels must start at the top of the viewport')
    check(Math.abs(panel.getBoundingClientRect().bottom - window.innerHeight) <= 1, 'Panels must extend to the bottom of the viewport')
    check(panel.getBoundingClientRect().bottom <= window.innerHeight + 1, 'Panel bottom is clipped')
  }
  check(page!.querySelectorAll('[role="separator"]').length === 2, 'Expected two accessible resize handles')
  const history = panels[0].querySelector<HTMLSelectElement>('#vision-history-select')
  check(!!history && !history.closest('details:not([open])'), 'History selector must be directly available')
  check(!!panels[0].querySelector('input[type="file"]'), 'Upload control missing from Source')
  check(!!panels[1].querySelector('[aria-label="图片识别审核"]'), 'Review workspace missing')
  check(!!panels[1].querySelector('[aria-label="DUPLO Catalog"]'), 'Catalog missing from Workspace')
  check(!!panels[2].querySelector('#session-inventory'), 'Inventory editor missing from right panel')
  check(!!panels[2].querySelector('[aria-label="生成正式积木游戏"]'), 'Game preparation missing from right panel')
  check(page!.querySelectorAll('#session-inventory').length === 1, 'Inventory must have exactly one editor')
  const catalog = panels[1].querySelector<HTMLElement>('.inventory-grid')
  if (catalog) {
    check(getComputedStyle(catalog).overflowX === 'auto', 'Catalog must own horizontal scrolling')
    check(catalog.getBoundingClientRect().width <= panels[1].clientWidth + 1, 'Catalog scroll container exceeds Workspace')
    for (const row of catalog.querySelectorAll<HTMLElement>('.inventory-part-row')) {
      const cells = [row.querySelector('.inventory-photo'), row.querySelector('.inventory-part-identity'),
        row.querySelector('select'), row.querySelector('.inventory-part-controls > button'),
        row.querySelector('input[type="number"]'), row.querySelector('.inventory-add > button')]
      check(cells.every(Boolean), 'Every Catalog row must retain all six fields')
      const rects = cells.map(cell => cell!.getBoundingClientRect())
      check(Math.max(...rects.map(r => r.top)) < Math.min(...rects.map(r => r.bottom)), 'Catalog controls wrapped onto another row')
      for (let i = 1; i < rects.length; i++) check(rects[i - 1].right <= rects[i].left + 1, 'Catalog fields overlap')
      const name = row.querySelector('h3')!
      check(name.title === name.textContent, 'Full name must remain available on hover')
    }
  }
  return { passed: true, widths: panels.map(panel => Math.round(panel.getBoundingClientRect().width)) }
}
