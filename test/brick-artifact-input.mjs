// Regression input is a real, user-generated artifact, never a prescribed stock
// or a synthetic design. The agent does not generate this file or run these tests.
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

export function readAcceptedArtifact() {
  if (!process.env.BRICK_GAME_ARTIFACT) throw new Error('Set BRICK_GAME_ARTIFACT to the actual generated/brick-games/designs/<id>.json selected in the UI; no fixture inventory is supplied.')
  const artifact = JSON.parse(readFileSync(process.env.BRICK_GAME_ARTIFACT, 'utf8'))
  if (!artifact.generation?.ok || !artifact.generation?.validation?.valid
    || createHash('sha256').update(JSON.stringify(artifact.generation.design)).digest('hex') !== artifact.designHash) throw new Error('A real accepted design artifact is required.')
  return artifact
}
