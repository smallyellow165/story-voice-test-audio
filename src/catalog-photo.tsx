import { useEffect, useRef, useState } from 'react'
import './catalog-photo.css'

export type Media = { status: string; url: string | null; cached?: boolean; cache_warning?: string;
  part_num?: string; color_id?: number | null; failure_reason?: string | null; attempt_count?: number;
  original_url?: string; local_path?: string; retry_at?: string | null }
const imageMessages: Record<string, string> = {
  loading: '图片信息加载中…', missing: 'Rebrickable 暂无图片', not_configured: '未配置 Rebrickable 图片 API Key',
  unauthorized: '图片 API Key 无效', forbidden: '图片 API 无访问权限', rate_limited: '图片 API 限流，请稍后再试',
  api_error: '图片信息获取失败', unsupported_image_url: '图片 URL 来源尚未支持',
  failed: '图片获取失败', queue_full: '图片队列繁忙，请稍后重试',
  image_storage_disabled: '图片持久化未启用，请先执行 Migration 并启用服务配置',
  timeout: '图片等待超时，可手动重试',
}

export function CatalogPhoto({ media, name }: { media?: Media; name: string }) {
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [current, setCurrent] = useState(media)
  const [retrying, setRetrying] = useState(false)
  const retryRequest = useRef<AbortController | null>(null)
  useEffect(() => { setCurrent(media) }, [media])
  useEffect(() => {
    setRetrying(false)
    return () => { retryRequest.current?.abort() }
  }, [media?.part_num, media?.color_id])
  useEffect(() => {
    if (current && current.status !== 'loading') return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const started = Date.now()
    const poll = async () => {
      if (Date.now() - started >= 120000) {
        setCurrent(old => ({ ...old, status: 'timeout', url: null })); return
      }
      if (current?.part_num) {
        try {
          const params = new URLSearchParams(current.color_id == null ? { part_nums: current.part_num }
            : { part_num: current.part_num, color_id: String(current.color_id) })
          const response = await fetch(`/api/brick-catalog/${current.color_id == null ? 'images' : 'color-image'}?${params}`, {
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]), cache: 'no-store',
          })
          if (!response.ok) throw new Error('image_status_failed')
          const body = await response.json()
          const next: Media = current.color_id == null ? body.images?.[current.part_num] : body
          if (!next || typeof next.status !== 'string') throw new Error('invalid_image_status')
          if (controller.signal.aborted) return
          setCurrent(next)
          if (next.status !== 'loading') return
        } catch {
          if (!controller.signal.aborted) setCurrent(old => ({ ...old, status: 'api_error', url: null }))
          return
        }
      }
      timer = setTimeout(() => void poll(), 2000)
    }
    timer = setTimeout(() => void poll(), 2000)
    return () => { controller.abort(); clearTimeout(timer) }
  }, [current?.status, current?.part_num, current?.color_id])
  useEffect(() => {
    setFailed(false); setLoaded(false)
  }, [current?.url])
  useEffect(() => {
    if (!current?.url || loaded || failed) return
    const timer = setTimeout(() => setFailed(true), 20000)
    return () => clearTimeout(timer)
  }, [current?.url, loaded, failed])
  const retry = async () => {
    if (!current?.part_num || retrying) return
    retryRequest.current?.abort()
    const controller = new AbortController(); retryRequest.current = controller
    setRetrying(true)
    try {
      const params = new URLSearchParams({ part_num: current.part_num })
      if (current.color_id != null) params.set('color_id', String(current.color_id))
      const response = await fetch(`/api/brick-catalog/image-retry?${params}`, { method: 'POST', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) })
      if (!response.ok) throw new Error('retry_failed')
      const next = await response.json()
      if (typeof next.status !== 'string') throw new Error('invalid_image_status')
      if (controller.signal.aborted) return
      setFailed(false); setLoaded(false); setCurrent(next)
    } catch { if (!controller.signal.aborted) setCurrent(old => ({ ...old, status: 'api_error', url: null })) }
    finally { if (!controller.signal.aborted) setRetrying(false) }
  }
  return <div className="inventory-photo">
    {current?.url && !failed ? <>
      {!loaded && <span>图片加载中…</span>}
      <img src={current.url} alt={name} style={{ opacity: loaded ? 1 : 0 }} onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />
    </> : <span role="status">{failed ? '图片加载失败' : imageMessages[current?.status || 'loading'] || '图片不可用'}
      {current?.failure_reason && <small> · {current.failure_reason}</small>}
      {current?.part_num && (failed || ['failed', 'queue_full', 'timeout', 'api_error', 'missing', 'not_configured', 'unauthorized', 'forbidden', 'rate_limited', 'unsupported_image_url'].includes(current.status)) &&
        <button type="button" disabled={retrying} onClick={() => void retry()}>{retrying ? '重试中…' : '重试图片'}</button>}
    </span>}
  </div>
}
