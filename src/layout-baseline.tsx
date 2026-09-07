import { createRoot } from 'react-dom/client'
import { ThreeColumnLayout } from './three-column-layout'
import './layout-baseline.css'

createRoot(document.getElementById('layout-root')!).render(
  <ThreeColumnLayout left="LEFT" center="CENTER" right="RIGHT" />,
)
