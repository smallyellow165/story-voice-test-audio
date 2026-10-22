import { useEffect, useState } from 'react'
import { CatalogPhoto } from '../catalog-photo'
import type { Media } from '../catalog-photo'
import { requestJson } from '../brick-inventory/api.mjs'
import { COLORS, PARTS } from './catalog'
import type { InventoryRow } from './design-types'

// Catalog enrichment is display-only. The original LDraw inventory rows and
// all quantity validation remain owned by AIDesignPanel.
export function AvailableInventory({ inventory, total, onQuantity }: {
  inventory: InventoryRow[]
  total: number
  onQuantity: (row: InventoryRow, quantity: number) => void
}) {
  const [images, setImages] = useState<Record<string, Media>>({})
  const [names, setNames] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({ part_nums: PARTS.map(part => part.id).join(',') })
    const init = { signal: controller.signal }
    void requestJson<{ images: Record<string, Media> }>('/api/brick-catalog/images?' + params, init, 'Catalog 图片').then(data => {
      if (!controller.signal.aborted) setImages(Object.fromEntries(PARTS.map(part => [part.id, data.images[part.id] || { status: 'missing', url: null }])))
    }).catch(() => {
      if (!controller.signal.aborted) setImages(Object.fromEntries(PARTS.map(part => [part.id, { status: 'api_error', url: null }])))
    })
    void requestJson<{ items: { part_num: string; name: string }[] }>('/api/brick-catalog/selection?' + params, init, 'Catalog 名称').then(data => {
      if (!controller.signal.aborted) setNames(Object.fromEntries(data.items.map((part: { part_num: string; name: string }) => [part.part_num, part.name])))
    }).catch(() => { if (!controller.signal.aborted) setNotice('Catalog 名称暂不可用，仍可按型号编辑库存。') })
    return () => controller.abort()
  }, [])
  return <div className="brick-available-inventory">
    <table>
      <caption>可用库存 · 共 {Number.isFinite(total) ? total : '—'} 块</caption>
      <thead><tr><th scope="col">零件</th><th scope="col">各颜色库存数量</th></tr></thead>
      <tbody>{PARTS.map(part => <tr key={part.id}>
        <th scope="row"><div className="brick-stock-part">
          <CatalogPhoto media={images[part.id]} name={names[part.id] || part.label + ' · ' + part.id} />
          <div className="brick-stock-identity"><strong>{names[part.id] || part.label}</strong>
            <span>{part.label} · LDraw {part.id}</span>
            <small title="按相同编号读取的 Rebrickable 展示资料；不用于建立或修改 LDraw Mapping。">Catalog 型号示意图，颜色以数量标签为准</small>
          </div>
        </div></th>
        <td><div className="brick-stock-colors">{COLORS.map(color => {
          const row = inventory.find(item => item.part === part.id && item.color === color.code)!
          return <label key={color.code}>{color.label}<input aria-label={part.id + ' ' + color.label + ' 库存'}
            type="number" min="0" max="100" step="1" required
            value={Number.isFinite(row.quantity) ? row.quantity : ''}
            onChange={event => onQuantity(row, event.target.valueAsNumber)} /></label>
        })}</div></td>
      </tr>)}</tbody>
    </table>
    {notice && <p className="brick-help" role="status">{notice}</p>}
  </div>
}
