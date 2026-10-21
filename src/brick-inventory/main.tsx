import { createRoot } from 'react-dom/client'
import { InventoryPage } from './InventoryPage'

const root = createRoot(document.getElementById('brick-inventory-root')!)
root.render(<InventoryPage />)
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount())
