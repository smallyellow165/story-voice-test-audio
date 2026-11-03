import {createRoot} from 'react-dom/client'
import {MagneticGallery} from './Gallery.tsx'
const root=createRoot(document.getElementById('gallery-root')!)
root.render(<MagneticGallery/> )
if(import.meta.hot)import.meta.hot.dispose(()=>root.unmount())
