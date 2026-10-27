import { createRoot } from 'react-dom/client'
import { BuildOrderPage } from '../brick-build/BuildOrderPage'
import { BrickTestPage } from './BrickTestPage'

const root = createRoot(document.getElementById('brick-test-root')!)
root.render(new URL(location.href).searchParams.get('workflow') === 'build' ? <BuildOrderPage /> : <BrickTestPage />)
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount())
