import { useEffect, useState } from 'react'
import './catalog-photo.css'

export type Media = { status: string; url: string | null; cached?: boolean; cache_warning?: string }
const imageMessages: Record<string, string> = {
  loading: '图片信息加载中…', missing: 'Rebrickable 暂无图片', not_configured: '未配置 Rebrickable 图片 API Key',
  unauthorized: '图片 API Key 无效', forbidden: '图片 API 无访问权限', rate_limited: '图片 API 限流，请稍后再试',
  api_error: '图片信息获取失败', unsupported_image_url: '图片 URL 来源尚未支持',
}

export function CatalogPhoto({ media, name }: { media?: Media; name: string }) {
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => { setFailed(false); setLoaded(false) }, [media?.url])
  return <div className="inventory-photo">
    {media?.url && !failed ? <>
      {!loaded && <span>图片加载中…</span>}
      <img src={media.url} alt={name} loading="lazy" style={{ opacity: loaded ? 1 : 0 }} onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />
    </> : <span>{failed ? '图片加载失败' : imageMessages[media?.status || 'loading'] || '图片不可用'}</span>}
  </div>
}
