import {createRoot} from 'react-dom/client'
import {Gallery} from './Gallery'
const root=createRoot(document.getElementById('gallery-root')!);root.render(<Gallery/>);if(import.meta.hot)import.meta.hot.dispose(()=>root.unmount())
