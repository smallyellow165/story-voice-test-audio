import { useEffect, useState } from 'react'
import { loadSessions } from './storage'
import { postBrickGame, requestJson } from './api.mjs'
import type { GenerationAttempt } from './api.mjs'
import type { SessionInventory } from './inventory'
import type { InventoryReview } from '../brick-game-contract'
type ModelStatus = { model: string; models: { id: string; label: string }[] }

export function GamePreparation() {
  const [sessions, setSessions] = useState<SessionInventory[]>([])
  const [selected, setSelected] = useState('')
  const [review, setReview] = useState<InventoryReview | null>(null)
  const [attempt, setAttempt] = useState<GenerationAttempt | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [description, setDescription] = useState('')
  const [model, setModel] = useState('')
  const [models, setModels] = useState<{ id: string; label: string }[]>([])
  const [v4Url, setV4Url] = useState(() => { const url = new URL(location.href); url.port = '4000'; url.pathname = '/'; url.search = ''; url.hash = ''; return url.href })
  const refresh = () => { try { setSessions(loadSessions(localStorage)); setError('') } catch (e) { setError(String(e)) } }
  useEffect(() => {
    refresh()
    let disposed = false
    void requestJson<ModelStatus>('/api/brick-test/generate', {}, 'Gemini 配置').then(result => {
      if (!disposed) { setModels(result.models); setModel(result.model) }
    }).catch(e => { if (!disposed) setError(String(e)) })
    return () => { disposed = true }
  }, [])
  const chosen = sessions.find(s => s.id === selected)
  const start = () => {
    try {
      const url = new URL(v4Url)
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('V4 地址必须是 HTTP(S) 地址。')
      url.searchParams.set('brickGame', attempt!.artifact!.id)
      window.open(url.href, '_blank', 'noopener,noreferrer')
    } catch (e) { setError(String(e)) }
  }
  return <section className="inventory-catalog" style={{ marginTop: 24 }} aria-label="生成正式积木游戏">
    <h2>从已保存库存生成游戏</h2>
    <p>仅读取你明确选择并保存的库存。修改库存后请先保存，再刷新列表并重新检查。</p>
    <div className="inventory-filters">
      <label>已保存 Session<select value={selected} disabled={!!busy} onChange={e => { setSelected(e.target.value); setReview(null); setAttempt(null) }}>
        <option value="">请选择库存</option>{sessions.map(s => <option key={s.id} value={s.id}>{s.name} · {s.updated_at}</option>)}
      </select></label><button disabled={!!busy} onClick={() => { refresh(); setReview(null); setAttempt(null) }}>刷新保存列表</button>
      <button disabled={!chosen || !!busy} onClick={async () => {
        setBusy('读取已保存库存并查询官方映射…'); setError(''); setReview(null); setAttempt(null)
        try {
          const saved = loadSessions(localStorage).find(s => s.id === selected)
          if (!saved) throw new Error('所选库存已不存在，请刷新列表。')
          setSessions(loadSessions(localStorage))
          setReview(await postBrickGame('review', { session: saved }))
        } catch (e) { setError(String(e)) } finally { setBusy('') }
      }}>查看库存与映射</button>
    </div>
    {chosen && <details open><summary>读取来源：{chosen.name} · {chosen.id}</summary><pre style={{ overflow: 'auto' }}>{JSON.stringify(review?.session || chosen, null, 2)}</pre></details>}
    {review && <>
      <p>检查记录：{review.id} · 映射 {review.mapping.valid ? 'Valid' : 'Invalid'}</p>
      <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Rebrickable 型号 / 名称</th><th>Rebrickable 颜色</th><th>数量</th><th>LDraw 型号 / 颜色</th><th>结果</th></tr></thead>
        <tbody>{review.mapping.rows.map(row => <tr key={`${row.source.part_num}:${row.source.color_id}`}>
          <td>{row.source.part_num} · {row.sourcePartName}</td><td>{row.source.color_id} · {row.sourceColorName}</td><td>{row.source.quantity}</td>
          <td>{row.target ? `已选择 ${row.target.part} / ${row.target.color} · ${row.target.colorName}` : '未选择目标'}
            <div>官方型号候选：{row.partCandidates.join(', ') || '无'}；颜色候选：{row.colorCandidates.join(', ') || '无'}</div>
            <ul>{row.partCandidateChecks.map(candidate => <li key={candidate.part}>
              {candidate.part}：Runtime {candidate.supported ? '支持' : '不支持'}；
              本地入口{candidate.local.entryAvailable ? '可读' : '不可用'}；
              依赖检查{candidate.local.available ? '通过' : '未通过'}（{candidate.local.checkedFiles} 个文件）。
              {candidate.eligible ? (row.target?.part === candidate.part ? '已选中' : '有效候选，未选择') : `已排除：${candidate.reasons.join('；')}`}
            </li>)}</ul>
          </td>
          <td>{row.errors.join('；') || '映射通过'}</td></tr>)}</tbody></table></div>
      {review.mapping.issues.map(issue => <p className="inventory-error" key={issue}>{issue}</p>)}
      <details><summary>映射原始证据 / 将发送的 Generator 库存</summary><pre style={{ overflow: 'auto' }}>{JSON.stringify(review.mapping, null, 2)}</pre></details>
    </>}
    <div className="inventory-filters"><label>想搭什么<input maxLength={500} value={description} disabled={!!busy || !!attempt} onChange={e => setDescription(e.target.value)} placeholder="请输入造型描述" /></label>
      <label>Gemini 模型<select disabled={!!busy || !!attempt} value={model} onChange={e => setModel(e.target.value)}>{models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
      <button disabled={!review?.mapping.valid || !description.trim() || !model || !!busy || !!attempt} onClick={async () => {
        setBusy('Gemini 生成及 Validator 验证中；不会自动重试…'); setError('')
        try { setAttempt(await postBrickGame('generate', { reviewId: review!.id, description, model })) }
        catch (e) { setError(String(e)) } finally { setBusy('') }
      }}>确认库存并生成游戏</button></div>
    <p role="status">{busy}</p>{error && <p role="alert" className="inventory-error">{error}</p>}
    {attempt && <>
      <p>Validator：{attempt.generation.validation?.valid ? 'Valid' : 'Invalid'} · 请求模型 {attempt.generation.model} · 返回模型 {attempt.generation.modelVersion} · {attempt.generation.elapsedMs} ms · {attempt.generation.finishReason}</p>
      {attempt.generation.error && <p role="alert">{attempt.generation.error.message}</p>}
      <details open><summary>实际模型输入 / Design / Steps / 库存消耗 / 原始输出</summary><pre style={{ maxHeight: 500, overflow: 'auto' }}>{JSON.stringify(attempt, null, 2)}</pre></details>
      {attempt.artifact && <><p>已验证设计：{attempt.artifact.generation.design.name} · ID {attempt.artifact.id} · SHA-256 {attempt.artifact.designHash}</p>
        <label>V4 页面地址<input value={v4Url} onChange={e => setV4Url(e.target.value)} /></label><button onClick={start}>在 V4 启动这个游戏</button></>}
      <p>如需再次生成，明确点击“查看库存与映射”建立新检查记录后再提交。</p>
    </>}
  </section>
}
