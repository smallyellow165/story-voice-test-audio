import type { Matching, Operation } from './reading-v2.ts'
const esc = (v:unknown) => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!)
export const v2Chars = (m:Matching, op:string) => m.path.filter(p => p.op === op).map(p => op === 'phonetic' ? `${p.reference?.text}/${p.stt?.text}` : p.reference?.text ?? p.stt?.text).join('、') || '无'
export const v2Point = (m:Matching) => m.candidate_cursor === null ? '无有效候选' : `${m.candidate_cursor}「${m.reference_tokens[m.candidate_cursor]?.text}」候选`
function pathTable(path:Operation[]) {
 return `<table><thead><tr><th>Reference</th><th>STT</th><th>类型 / 证据</th><th>Cost</th></tr></thead><tbody>${path.map(p => `<tr><td>${esc(p.reference?.text ?? '—')}<small> ${esc(p.reference?.pinyin ?? '')}</small></td><td>${esc(p.stt?.text ?? '—')}<small> ${esc(p.stt?.pinyin ?? '')}</small></td><td>${esc(p.op)} / ${esc(p.evidence)}</td><td>${p.cost}</td></tr>`).join('')}</tbody></table>`
}
export function v2Details(m:Matching) {
 return `<p><strong>STT：</strong>${esc(m.stt_input)} · ${m.stt_type === 'F' ? 'Final' : 'Partial'}</p>
 <p>Candidate Cursor：${esc(v2Point(m))} · Range：${esc(JSON.stringify(m.reference_range))} · Score：${m.score} / Cost：${m.cost}</p>
 <p>Ambiguity：${m.ambiguous ? '是，不选择位置' : '否'} · ${esc(m.reason)}</p>
 <p class="muted">这是本次实际候选路径，不是累计 Tracking 状态。Final 不代表确认读对；Delete 不是断言漏读，Score 不是概率。无有效候选时，路径仅供诊断。</p>
 ${pathTable(m.path)}
 ${m.alternatives.length ? `<details><summary>实际等优路径 / 歧义候选 (${m.alternatives.length})</summary>${m.alternatives.map(a => `<p>Range ${esc(JSON.stringify(a.reference_range))} · Cost ${a.cost}</p>${pathTable(a.path)}`).join('')}</details>` : ''}`
}
