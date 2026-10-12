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
  strategy: Strategy = 'V1'
  draftParameters: Config = { ...defaults }
  applied: Config = { ...defaults }
  template?: Scenario
  loaded?: { scenario: Scenario; reference: string; sequence: string }
  last?: { input: NonNullable<ReadingWorkbench['loaded']>; config: Config; strategy: Strategy; results: ReturnType<typeof compare>; suite: { scenario: Scenario; results: ReturnType<typeof compare> }[] }
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
    createTracker('验证', 'V1', this.draftParameters)
    this.applied = { ...this.draftParameters }
  }
  resetParameters() { this.draftParameters = { ...defaults }; this.applied = { ...defaults } }
  get inputPending() { return !this.loaded || this.loaded.reference !== this.draftReference || this.loaded.sequence !== this.draftSequence }
  get parametersPending() { return JSON.stringify(this.draftParameters) !== JSON.stringify(this.applied) }
  get stale() {
    return !!this.last && (this.inputPending || JSON.stringify(this.loaded) !== JSON.stringify(this.last.input)
      || this.strategy !== this.last.strategy || JSON.stringify(this.applied) !== JSON.stringify(this.last.config))
  }
  match(scenarios: Scenario[] = []) {
    if (!this.loaded || this.inputPending) throw new Error('输入已编辑，请先 Load STT Sequence。')
    const input = structuredClone(this.loaded), config = { ...this.applied }, strategy = this.strategy
    this.last = { input, config, strategy, results: compare(input.scenario, config),
      suite: scenarios.map(scenario => ({ scenario, results: compare(scenario, config) })) }
  }
}
