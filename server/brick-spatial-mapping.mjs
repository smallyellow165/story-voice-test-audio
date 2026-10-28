// Run-scoped adapter only. Shared definitions are owned by Parts Geometry.
import { randomUUID } from 'node:crypto'
import { resolvePartsGeometry } from './brick-parts-geometry.mjs'
export async function spatialMapping(session, rules, dependencies = {}) {
 const resolved = await resolvePartsGeometry(session.items, rules, dependencies)
 return { id: randomUUID(), session, mapping: { rows: resolved.rows, valid: resolved.valid } }
}
