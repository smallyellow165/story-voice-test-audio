import './bottom-sheet.css'

// Generic modal surface; content remains owned by the caller.
export function createBottomSheet(options: { title: string; content: HTMLElement; footer?: HTMLElement; root?: Document | ShadowRoot }) {
  const dialog = document.createElement('dialog')
  dialog.className = 'bottom-sheet'
  const heading = document.createElement('h2')
  heading.id = `sheet-${crypto.randomUUID()}`
  heading.textContent = options.title
  dialog.setAttribute('aria-labelledby', heading.id)
  const header = document.createElement('header'), closeButton = document.createElement('button')
  closeButton.type = 'button'; closeButton.textContent = '关闭'; closeButton.setAttribute('aria-label', '关闭 Bottom Sheet')
  header.append(heading, closeButton)
  const body = document.createElement('div'); body.className = 'bottom-sheet__body'; body.append(options.content)
  dialog.append(header, body)
  if (options.footer) { const footer = document.createElement('footer'); footer.append(options.footer); dialog.append(footer) }
  const root = options.root || document
  ;(root instanceof Document ? root.body : root).append(dialog)
  let timer: ReturnType<typeof setTimeout> | undefined, previous: HTMLElement | null = null
  let overflow = '', backdropDown = false
  function finish() {
    clearTimeout(timer); timer = undefined
    dialog.close(); dialog.classList.remove('is-open')
    document.documentElement.style.overflow = overflow
    previous?.focus()
  }
  function close() {
    if (!dialog.open || timer) return
    dialog.classList.remove('is-open')
    timer = setTimeout(finish, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180)
  }
  const outside = (event: MouseEvent) => {
    const r = dialog.getBoundingClientRect()
    return event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom
  }
  dialog.addEventListener('pointerdown', event => { backdropDown = event.target === dialog && outside(event) })
  dialog.addEventListener('click', event => { if (backdropDown && event.target === dialog && outside(event)) close(); backdropDown = false })
  dialog.addEventListener('cancel', event => { event.preventDefault(); close() })
  closeButton.onclick = close
  return {
    open() {
      if (dialog.open) return
      previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
      overflow = document.documentElement.style.overflow
      document.documentElement.style.overflow = 'hidden'
      dialog.showModal()
      void dialog.offsetHeight
      dialog.classList.add('is-open')
      closeButton.focus()
    },
    close,
    destroy() { if (dialog.open) finish(); clearTimeout(timer); dialog.remove() },
  }
}
