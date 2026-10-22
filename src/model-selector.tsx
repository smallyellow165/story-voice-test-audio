type ModelOption = { id: string; label: string; provider: string }
type Props<T extends ModelOption> = {
  label?: string
  models: readonly T[]
  value: { id: string; provider: string }
  disabled?: boolean
  onChange: (model: T) => void
}
const key = (model: { id: string; provider: string }) => JSON.stringify([model.provider, model.id])

// Presentation only: each caller supplies its endpoint's supported models,
// current selection and existing change handler. No requests/default selection.
export function ModelSelector<T extends ModelOption>({ label = 'Provider / 模型', models, value, disabled, onChange }: Props<T>) {
  return <label>{label}<select value={key(value)} disabled={disabled} onChange={event => {
    const chosen = models.find(model => key(model) === event.target.value)
    if (chosen) onChange(chosen)
  }}>
    {!models.length && <option value={key(value)}>正在读取模型配置…</option>}
    {models.map(model => <option key={key(model)} value={key(model)}>{model.provider} · {model.label} · {model.id}</option>)}
  </select></label>
}
