import { scenarios, compare } from '../src/reading-tracker-scenarios.ts'
import { defaults } from '../src/reading-tracker.ts'

const args = process.argv.slice(2)
const help = 'npm run reading:replay -- [--scenario ID] [--json] [--trace] [--strict] [--lookBack N --lookAhead N --maxGap N --support N --repeatSupport N --minCoverage 0.6 --maxExtra N]'
if (args.includes('--help')) { console.log(help); process.exit(0) }
const config = {}, options = { json: false, trace: false, strict: false }
let selected
try {
  for (let i = 0; i < args.length; i++) {
    const name = args[i].replace(/^--/, '')
    if (name in options) options[name] = true
    else if (name === 'scenario') {
      selected = args[++i]
      if (!selected || selected.startsWith('--')) throw new Error('--scenario requires an ID')
    }
    else if (name in defaults) config[name] = Number(args[++i])
    else throw new Error(`Unknown argument: ${args[i]}`)
  }
  const items = selected ? scenarios.filter(s => s.id === selected) : scenarios
  if (!items.length) throw new Error(`Unknown scenario: ${selected}`)
  const report = items.map(scenario => ({ id: scenario.id, title: scenario.title, comparison: compare(scenario, config) }))
  if (options.json) console.log(JSON.stringify({ config: { ...defaults, ...config }, report }, null, 2))
  else {
    console.log('Reading Tracker — synthetic event targets (not child speech accuracy)')
    console.log('Config:', { ...defaults, ...config })
    console.table(report.map(r => Object.fromEntries([['scenario', r.id], ...r.comparison.map(c =>
      [c.strategy, `${c.rows.filter(row => !row.differences.length).length}/${c.rows.length} events`])])) )
    for (const result of report) for (const comparison of result.comparison) {
      for (const row of comparison.rows) if (options.trace || row.differences.length) {
        const s = row.state
        console.log(`${result.id} ${comparison.strategy} #${row.index + 1} ${s.decision.action}/${s.decision.reason} cursor=${s.cursor} confirmed=${s.confirmed} furthest=${s.furthest}`)
        console.log(`  matched=[${s.matched}] skipped=[${s.skipped}] uncertain=[${s.uncertain}] ${row.differences.join(' | ') || 'target met'}`)
      }
    }
  }
  if (options.strict && report.some(r => r.comparison.some(c => c.rows.some(row => row.differences.length)))) process.exitCode = 1
} catch (error) { console.error(error.message, '\n', help); process.exitCode = 2 }
