import { createTracker, track, strategies } from './reading-tracker.ts'
import type { Config, ReadingEvent, Strategy, TrackerState } from './reading-tracker.ts'

export const poem = '床前明月光，\n疑是地上霜。\n举头望明月，\n低头思故乡。'
export interface Goal {
  cursor: number; confirmed: number; matched: number[]; skipped: number[]; uncertain: number[]
}
export interface ReplayStep { event: ReadingEvent; goal?: Goal; note: string }
export interface Scenario { id: string; title: string; reference: string; steps: ReplayStep[] }
// Hand-authored reading targets, independent of any strategy's output. A mismatch is an
// experimental failure to achieve the target, not automatically a software defect.
export function indices(spec: string): number[] {
  return spec ? spec.split(',').flatMap(part => {
    const [a, b] = part.split('-').map(Number)
    return Array.from({ length: (b ?? a) - a + 1 }, (_, i) => a + i)
  }) : []
}
const goal = (cursor: number, confirmed: number, m = '', s = '', u = ''): Goal =>
  ({ cursor, confirmed, matched: indices(m), skipped: indices(s), uncertain: indices(u) })
const stt = (seq: number, text: string, final = false, segment = 'a', epoch = 0): ReadingEvent =>
  ({ type: 'stt', epoch, seq, segment, at: seq * 400, text, final })
const step = (event: ReadingEvent, target: Goal, note = ''): ReplayStep => ({ event, goal: target, note })
const scenario = (id: string, title: string, steps: ReplayStep[], reference = poem): Scenario => ({ id, title, steps, reference })
export const scenarios: Scenario[] = [
  scenario('normal', '正常逐字朗读', [
    step(stt(1, '床'), goal(0, -1, '0')),
    step(stt(2, '床前'), goal(1, -1, '0-1')),
    step(stt(3, '床前明'), goal(2, -1, '0-2')),
    step(stt(4, '床前明月'), goal(3, -1, '0-3')),
    step(stt(5, '床前明月光', true), goal(4, 4, '0-4')),
  ]),
  scenario('whole', '一次识别完整句子', [step(stt(1, '床前明月光', true), goal(4, 4, '0-4'))]),
  scenario('skip-one', '漏一字：支持到达前先 Hold', [
    step(stt(1, '床明月'), goal(0, -1, '0'), 'V1 保留精确前缀，暂不跨越缺口；基线可能抢先推进'),
    step(stt(2, '床明月光'), goal(4, -1, '0,2-4', '1')),
    step(stt(3, '床明月光', true), goal(4, 4, '0,2-4', '1')),
  ]),
  scenario('skip-multiple', '连漏两字：默认参数的已知限制', [
    step(stt(1, '床月光', true), goal(4, 4, '0,3-4', '1-2'), '目标为跟到光；默认 maxGap=1 应保守停留，调到 2 再比较'),
  ]),
  scenario('substitution', '识别不一致后继续：不判孩子读错', [
    step(stt(1, '床钱明月光', true), goal(4, 4, '0,2-4', '', '1')),
  ]),
  scenario('repeat', '跨片段局部重读：光标回退，最远进度保留', [
    step(stt(1, '床前明月光', true), goal(4, 4, '0-4')),
    step(stt(2, '床前', false, 'b'), goal(4, 4, '0-4'), '两个字先 Hold'),
    step(stt(3, '床前明', true, 'b'), goal(2, 2, '0-4'), '明确重读；基线不会回退'),
    step(stt(4, '月光', true, 'c'), goal(4, 4, '0-4')),
  ]),
  scenario('partial-repeat', '局部回读：新增 Partial 支持暂定回退', [
    step(stt(1, '床前明月光', true), goal(4, 4, '0-4')),
    step(stt(2, '床前明', false, 'b'), goal(4, 4, '0-4')),
    step(stt(3, '床前明月', false, 'b'), goal(3, 4, '0-4')),
    step(stt(4, '床前明月', true, 'b'), goal(3, 3, '0-4')),
  ]),
  scenario('revision', 'Partial 增长、缩短、替换、清空', [
    step(stt(1, '床前明月'), goal(3, -1, '0-3')),
    step(stt(2, '床前'), goal(1, -1, '0-1')),
    step(stt(3, '床前明'), goal(2, -1, '0-2')),
    step(stt(4, ''), goal(-1, -1)),
    step(stt(5, '床'), goal(0, -1, '0')),
    step(stt(6, '床', true), goal(0, 0, '0')),
  ]),
  scenario('duplicate', '同一 Partial 重发及重复 Final', [
    step(stt(1, '床前'), goal(1, -1, '0-1')),
    step(stt(1, '床前'), goal(1, -1, '0-1'), '相同序号忽略'),
    step(stt(2, '床前'), goal(1, -1, '0-1'), '新序号相同假设不是新增支持'),
    step(stt(3, '床前', true), goal(1, 1, '0-1')),
    step(stt(4, '床前', true), goal(1, 1, '0-1'), '已结算片段不能再消费'),
  ]),
  scenario('replacement', 'Partial 替换并撤销不一致标记', [
    step(stt(1, '床前明月'), goal(3, -1, '0-3')),
    step(stt(2, '床钱明月'), goal(0, -1, '0')),
    step(stt(3, '床钱明月光'), goal(4, -1, '0,2-4', '', '1')),
    step(stt(4, '床前明月光', true), goal(4, 4, '0-4')),
  ]),
  scenario('same-text', '不同片段相同文字：真实重读', [
    step(stt(1, '床前明', true), goal(2, 2, '0-2')),
    step(stt(2, '床前明', true, 'b'), goal(2, 2, '0-2'), 'V1 Repeat，不是事件去重'),
  ]),
  scenario('repeated-reference', '原文重复文字：不能跳到第二个明月', [
    step(stt(1, '床前明月光', true), goal(4, 4, '0-4')),
    step(stt(2, '明月', true, 'b'), goal(4, 4, '0-4'), '短重复不足以重新定位'),
  ]),
  scenario('pause', '停顿不产生进度', [
    step(stt(1, '床前'), goal(1, -1, '0-1')),
    step({ type: 'pause', epoch: 0, at: 5000 }, goal(1, -1, '0-1')),
    step({ type: 'pause', epoch: 0, at: 20000 }, goal(1, -1, '0-1')),
    step({ ...stt(2, '床前', true), at: 21000 }, goal(1, 1, '0-1')),
  ]),
  scenario('large-jump', '跨句跳读：安全 Hold，不全局搜索', [
    step(stt(1, '床前', true), goal(1, 1, '0-1')),
    step(stt(2, '举头望明月', true, 'b'), goal(1, 1, '0-1'), '这是安全边界目标，并非跟踪真实远处位置成功'),
  ]),
  scenario('restart', 'Restart 隔离旧 Final', [
    step(stt(1, '床前明月'), goal(3, -1, '0-3')),
    step({ type: 'restart', epoch: 1, at: 800 }, goal(-1, -1)),
    step(stt(3, '床前明月光', true), goal(-1, -1), '旧 epoch 的 Final'),
    step({ ...stt(1, '床', true, 'new', 1), at: 1600 }, goal(0, 0, '0')),
  ]),
  scenario('punctuation', '标点、空白及 Unicode 原文映射', [
    step(stt(1, '床前明月', true), goal(3, 3, '0-3')),
  ], '「床， 前」\n明😀月。'),
  scenario('false-end', 'Partial 到末尾，Final 撤销结尾', [
    step(stt(1, '床前明月光'), goal(4, -1, '0-4')),
    step(stt(2, '床前明', true), goal(2, 2, '0-2')),
  ], '床前明月光'),
  scenario('chunking', 'Final 分块后接续 Partial', [
    step(stt(1, '床前', true), goal(1, 1, '0-1')),
    step(stt(2, '明月', false, 'b'), goal(3, 1, '0-3')),
    step(stt(3, '明月光', true, 'b'), goal(4, 4, '0-4')),
  ]),
  scenario('off-task', '离题语音中的零散原文字', [
    step(stt(1, '床前', true), goal(1, 1, '0-1')),
    step(stt(2, '妈妈我想看明月但是先喝水', true, 'b'), goal(1, 1, '0-1')),
  ]),
  scenario('within-repeat', '同片段重复前缀', [
    step(stt(1, '床前床前明月光', true), goal(4, 4, '0-4')),
  ]),
  scenario('ambiguous-short', '相邻同字：文本本身无法判断是重读还是继续', [
    step(stt(1, '哈', true), goal(0, 0, '0')),
    step(stt(2, '哈', true, 'b'), goal(0, 0, '0'), '人工设定为重读；顺序先验可能误前进，这是已知不可辨识案例'),
  ], '哈哈笑'),
  scenario('long-input', '超过窗口的整段输入：明确暴露限制', [
    step(stt(1, '小熊走进森林看见小兔正在树下读书于是坐在旁边一起听故事', true), goal(26, 26, '0-26'), '默认 lookAhead=24 会 Hold；增加窗口可比较'),
  ], '小熊走进森林看见小兔正在树下读书于是坐在旁边一起听故事'),
]

export function differences(state: TrackerState, expected: Goal): string[] {
  return (Object.keys(expected) as (keyof Goal)[]).flatMap(key =>
    JSON.stringify(state[key]) === JSON.stringify(expected[key]) ? [] : [`${key}: ${JSON.stringify(state[key])} ≠ ${JSON.stringify(expected[key])}`])
}
export function replay(scenario: Scenario, strategy: Strategy, config: Partial<Config> = {}) {
  let state = createTracker(scenario.reference, strategy, config)
  return scenario.steps.map((step, index) => {
    state = track(state, step.event)
    return { index, ...step, state, differences: step.goal ? differences(state, step.goal) : [] }
  })
}
export function compare(scenario: Scenario, config: Partial<Config> = {}) {
  return strategies.map(strategy => ({ strategy, rows: replay(scenario, strategy, config) }))
}
