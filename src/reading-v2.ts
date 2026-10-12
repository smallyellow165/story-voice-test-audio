// Presentation contract only; all alignment and parameter validation live in Python.
export const v2Defaults = {
  look_back: 4, look_ahead: 12, exact_cost: 0, homophone_cost: 0.1, near_cost: 0.45,
  replace_cost: 1.25, insert_cost: 0.9, delete_cost: 0.9, min_evidence_ratio: 0.6,
  max_cost_per_stt: 0.7, max_paths: 128, epsilon: 0.000001, max_stt_tokens: 128,
  initial_pairs: [['m','n'],['n','l'],['z','zh'],['c','ch'],['s','sh']],
  final_pairs: [['an','ang'],['en','eng'],['in','ing']],
}
export const v2Hints: Record<string,string> = {
 look_back:'从输入 Cursor 下一字向后取 Reference 窗口；增大可容纳重读，也增加重复位置歧义。',
 look_ahead:'从输入 Cursor 下一字向前取 Reference 窗口；增大允许更远候选。窗口之外不搜索。',
 exact_cost:'规范化字符完全相同的代价；越小越优先。',
 homophone_cost:'汉字不同、完整拼音含声调相同的代价，例如 晓/小。',
 near_cost:'仅声调不同，或同声调且声母/韵母之一相同、另一属于配置近音对的代价，例如 眠/年。不是发音正确判定。',
 replace_cost:'不属于 Exact 或 Phonetic 的替换代价。必须大于 near_cost。',
 insert_cost:'每个额外 STT 字符的代价，包括首尾；不能免费丢弃 STT。',
 delete_cost:'候选区间内每个 Reference 缺字的代价；Reference 区间前后未朗读部分免费。',
 min_evidence_ratio:'(Exact + Phonetic) 数量 / 完整 STT 规范化字符数；含额外输入，不含标点空白。低于此值不返回有效 Cursor。',
 max_cost_per_stt:'总代价 / STT 规范化字符数的上限；越小越严格。不是概率。',
 max_paths:'最多检查多少条等优 traceback；超限保守返回歧义，不强选位置。',
 epsilon:'Biopython 比较等优分数的数值容差，必须大于 0 且不超过 0.001。',
 max_stt_tokens:'完整 STT 规范化字符数量上限，超过则无候选，不截断。',
 initial_pairs:'近音声母对 JSON；双向生效。须同声调、同韵母，例如 m/n。只是假设，不是训练模型。',
 final_pairs:'近音韵母对 JSON；双向生效。须同声调、同声母，例如 an/ang。',
}
export type V2Parameters = typeof v2Defaults
export interface Token { index:number; text:string; pinyin:string|null }
export interface Operation { op:string; evidence:string; cost:number; reference:Token|null; stt:Token|null }
export interface Matching { stt_input:string; stt_type:string; candidate_cursor:number|null; reference_range:number[]|null; path:Operation[]; score:number|null; cost:number|null; ambiguous:boolean; reason:string; reference_tokens:Token[]; alternatives: {path:Operation[]; reference_range:number[]; cost:number}[] }
export interface V2Result { rows:{seq:number; matching:Matching}[]; reference:string; semantics:string }
export async function requestV2(payload:unknown):Promise<V2Result> {
 const response = await fetch('/api/debug/reading-v2/match', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload), signal:AbortSignal.timeout(20000)})
 const data = await response.json()
 if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
 return data
}
