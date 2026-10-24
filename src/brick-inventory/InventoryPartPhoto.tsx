import { useCallback, useEffect, useRef, useState } from 'react'
import { CatalogPhoto } from '../catalog-photo'
import type { Media } from '../catalog-photo'
import { readInventoryImage } from './inventory-image-request.mjs'

// Parent keys this component by the canonical Part Number + Color ID. No image
// URL is written into inventory truth, so reload always uses the saved identity.
export function InventoryPartPhoto({ partNum, colorId, name, genericMedia }: {
  partNum: string; colorId: number; name: string; genericMedia?: Media
}) {
  const [phase, setPhase] = useState<'color' | 'generic'>('color')
  const [media, setMedia] = useState<Media>({ status: 'loading', url: null })
  const generic = useRef(genericMedia)
  generic.current = genericMedia
  const useGeneric = useCallback(() => {
    setMedia({ status: 'loading', url: null })
    setPhase('generic')
  }, [])
  useEffect(() => {
    let active = true
    // Leave identity unset until metadata returns: CatalogPhoto must not start
    // polling while this initial metadata request is still in flight.
    setMedia({ status: 'loading', url: null })
    const known = phase === 'generic' ? generic.current : undefined
    if (known?.url && known.status === 'available') {
      setMedia({ ...known, part_num: partNum, color_id: null })
      return () => { active = false }
    }
    void readInventoryImage(partNum, phase === 'color' ? colorId : null).then(next => {
      if (active) setMedia(next)
    }).catch(() => {
      if (active) setMedia({ status: 'api_error', url: null, part_num: partNum,
        color_id: phase === 'color' ? colorId : null })
    })
    return () => { active = false }
  }, [partNum, colorId, phase])
  return <div className="inventory-item-photo" title={phase === 'color' ? '所选颜色图片' : '型号示意图，颜色以清单为准'}>
    <CatalogPhoto key={phase} media={media} name={name}
      onUnavailable={phase === 'color' ? useGeneric : undefined} />
  </div>
}
