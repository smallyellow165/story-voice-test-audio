// Read-only, single local part. No network, model invocation or registration writes.
import { inspectBrickModel, brickLibraryRoot } from '../server/brick-library.mjs'
import { loadBrickRules } from '../server/brick-rules.mjs'

const [part, library = brickLibraryRoot(), ...extra] = process.argv.slice(2)
if (!part || !/^[a-z0-9_-]+$/i.test(part) || extra.length) {
  console.error('Usage: node scripts/inspect-brick-geometry.mjs <LDraw ID> [library directory]')
  process.exitCode = 2
} else {
  const local = await inspectBrickModel(part, library, { extractGeometry: true })
  const rules = await loadBrickRules()
  const capability = rules.geometrySupport(part)
  console.log(JSON.stringify({ part, local, capability,
    identity: 'LDraw entry only; Rebrickable identity still requires official Mapping in Game Review',
    registration: 'Review primitive transforms, body bounds, underside and collision approximation before adding one reviewedRectangularPart data record. Extraction never registers support.',
  }, null, 2))
  if (!local.available) process.exitCode = 1
}
