import { createRoot } from 'react-dom/client'
import { BrickTestPage } from './BrickTestPage'

const root = createRoot(document.getElementById('brick-test-root')!)
root.render(<BrickTestPage />)
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount())
