import { tokenize } from './reading-tracker.ts'
import type { Scenario } from './reading-tracker-scenarios.ts'

export type STTSequence = ['P' | 'F', string][]
export const importLimitations = '仅按 Final 推导片段：连续 Partial 替换同一假设，Final 后进入下一片段。无法还原 Deepgram 音频范围、重叠、漏失 Final、重连或重启边界；请只导入一次 Reading Session 的完整序列。epoch=0、seq、segment 和每步 400ms 均为 Replay 推导值，不是真实 Provider 元数据。导入数据没有 Expected，Pass/Fail 为 N/A。'

export function importSequence(json: string, reference: string) {
  let value: unknown
  try { value = JSON.parse(json) } catch { throw new Error('请输入合法 JSON 二维数组，例如 [["P","床"],["F","床前"]]。') }
  if (!Array.isArray(value) || !value.length) throw new Error('STT Sequence 必须是非空数组。')
  for (const [index, entry] of value.entries()) {
    if (!Array.isArray(entry) || entry.length !== 2 || !['P', 'F'].includes(entry[0]) || typeof entry[1] !== 'string') {
      throw new Error(`第 ${index + 1} 条必须是 ["P" 或 "F", 原始文本字符串]，且只有两项。`)
    }
  }
  if (!tokenize(reference).length) throw new Error('Reference 必须包含可匹配的文字。')
  const rawSequence = value as STTSequence
  let segment = 1
  const scenario: Scenario = {
    id: 'imported-stt', title: '粘贴的 STT Sequence', reference,
    steps: rawSequence.map(([kind, text], index) => {
      const event = { type: 'stt' as const, epoch: 0, seq: index + 1, segment: `inferred-${segment}`, at: (index + 1) * 400, text, final: kind === 'F' }
      if (event.final) segment++
      return { event, note: '推导的 Replay 元数据；原始输入仅包含 P/F 与文本。' }
    }),
  }
  return { rawSequence, scenario, limitations: importLimitations,
    warning: rawSequence.at(-1)![0] === 'P' ? '最后一条为 Partial：保持暂定，不补造 Final。' : '' }
}
