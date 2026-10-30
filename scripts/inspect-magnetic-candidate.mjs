// Read-only snapshot inspection. Does not run reconstruction or any model.
import {readFile,writeFile} from 'node:fs/promises'
import {contentHash} from '../src/magnetic-tiles/build-plan.ts'
import {inspectDiagnosticConflicts} from '../src/magnetic-tiles/intake/candidate-conflicts.ts'
const [id='7274e2c2-9353-4382-b0b6-6cbb60583227',diagnostic='diagnostic-1',output]=process.argv.slice(2)
if(!/^[a-f0-9-]{36}$/.test(id))throw Error('Expected immutable Reconstruction UUID')
const record=JSON.parse(await readFile(new URL('../generated/magnetic-intake/reconstructions/'+id+'.json',import.meta.url),'utf8')),{hash,...payload}=record
if(hash!==await contentHash(payload))throw Error('Snapshot content hash mismatch')
const report=inspectDiagnosticConflicts(record,diagnostic)
if(output){await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({output,available:report.available,...(report.available?{references:report.references,currentReport:report.current.report}: {})},null,2))}else console.log(JSON.stringify(report,null,2))
