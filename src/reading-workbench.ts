import { v2Defaults } from './reading-v2.ts'
import type { V2Parameters, V2Result } from './reading-v2.ts'
import { defaults, createTracker } from './reading-tracker.ts'
import type { Config, Strategy } from './reading-tracker.ts'
import { compare } from './reading-tracker-scenarios.ts'
import type { Scenario } from './reading-tracker-scenarios.ts'
import { importSequence } from './reading-tracker-import.ts'

export function scenarioInput(scenario: Scenario) {
  const events = scenario.steps.map(s => s.event)
  return JSON.stringify(events.every(e => e.type === 'stt')
    ? events.map(e => e.type === 'stt' ? [e.final ? 'F' : 'P', e.text] : []) : events, null, 2)
}
export class ReadingWorkbench {
  draftReference = ''
  draftSequence = ''
  strategy: Strategy | 'V2' = 'V1'
  draftV2 = structuredClone(v2Defaults)
  appliedV2 = structuredClone(v2Defaults)
  cursor = -1
  cursorMode: 'fixed' | 'final_candidate' = 'final_candidate'
  loading = false
  requestId = 0
  draftParameters: Config = { ...defaults }
  applied: Config = { ...defaults }
  template?: Scenario
  loaded?: { scenario: Scenario; reference: string; sequence: string }
  last?: { input: NonNullable<ReadingWorkbench['loaded']>; config: Config; strategy: Strategy | 'V2'; v2?: V2Result; v2Config?: V2Parameters; cursor?:number; cursorMode?:string; results: ReturnType<typeof compare>; suite: { scenario: Scenario; results: ReturnType<typeof compare> }[] }
  select(scenario: Scenario) {
    this.template = scenario
    this.draftReference = scenario.reference
    this.draftSequence = scenarioInput(scenario)
  }
  load() {
    // Preserve authored pause/restart/epoch events and Expected only for untouched fixtures.
    const scenario = this.template && this.draftReference === this.template.reference && this.draftSequence === scenarioInput(this.template)
      ? structuredClone(this.template) : importSequence(this.draftSequence, this.draftReference).scenario
    this.loaded = { scenario, reference: this.draftReference, sequence: this.draftSequence }
  }
  apply() {
    if (this.strategy === 'V2') { this.appliedV2 = structuredClone(this.draftV2); return }
    createTracker('验证', 'V1', this.draftParameters)
    this.applied = { ...this.draftParameters }
  }
  resetParameters() { if (this.strategy === 'V2') { this.draftV2 = structuredClone(v2Defaults); this.appliedV2 = structuredClone(v2Defaults); return } this.draftParameters = { ...defaults }; this.applied = { ...defaults } }
  get inputPending() { return !this.loaded || this.loaded.reference !== this.draftReference || this.loaded.sequence !== this.draftSequence }
  get parametersPending() { if (this.strategy === 'V2') return JSON.stringify(this.draftV2) !== JSON.stringify(this.appliedV2); return JSON.stringify(this.draftParameters) !== JSON.stringify(this.applied) }
  get stale() {
    return !!this.last && (this.inputPending || JSON.stringify(this.loaded) !== JSON.stringify(this.last.input)
      || this.strategy !== this.last.strategy || (this.last.strategy === 'V2' ? JSON.stringify(this.appliedV2) !== JSON.stringify(this.last.v2Config) || this.cursor !== this.last.cursor || this.cursorMode !== this.last.cursorMode : JSON.stringify(this.applied) !== JSON.stringify(this.last.config)))
  }
  async matchV2(request: (payload:unknown) => Promise<V2Result>) {
    if (!this.loaded || this.inputPending) throw new Error('输入已编辑，请先 Load STT Sequence。')
    const input = structuredClone(this.loaded), v2Config = structuredClone(this.appliedV2)
    const events = input.scenario.steps.map(s => s.event)
    if (events.some(e => e.type !== 'stt')) throw new Error('V2 CLI 仅支持 P/F；pause/restart 场景请使用明确的单 Session P/F 输入。')
    const sequence = events.map(e => e.type === 'stt' ? [e.final ? 'F' : 'P', e.text] : [])
    const cursor = this.cursor, cursorMode = this.cursorMode, id = ++this.requestId
    this.loading = true
    try {
      const v2 = await request({reference:input.reference, sequence, cursor, cursor_mode:cursorMode, parameters:v2Config})
      if (id !== this.requestId) return false
      this.last = {input, config:{...this.applied}, strategy:'V2', v2Config, cursor, cursorMode, v2, results:[], suite:[]}
      return true
    } catch (e) { if (id === this.requestId) throw e; return false }
    finally { if (id === this.requestId) this.loading = false }
  }
  match(scenarios: Scenario[] = []) {
    if (this.strategy === 'V2') throw new Error('V2 必须通过异步 Python CLI Match。')
    if (!this.loaded || this.inputPending) throw new Error('输入已编辑，请先 Load STT Sequence。')
    ++this.requestId; this.loading = false
    const input = structuredClone(this.loaded), config = { ...this.applied }, strategy = this.strategy
    this.last = { input, config, strategy, results: compare(input.scenario, config),
      suite: scenarios.map(scenario => ({ scenario, results: compare(scenario, config) })) }
  }
}
