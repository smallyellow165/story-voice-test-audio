import type { Assembly3D } from './assembly.ts'
import type { Selection } from './editor-project.ts'

/** Connection indexes refer to the one current Assembly snapshot, never copied edges. */
export function AssemblySelectionTable({ assembly, selection, select, busy }: {
  assembly: Assembly3D; selection: Selection; select: (selection: Selection) => void; busy: boolean
}) {
  return <section className="magnetic-3d-selection-table" aria-label="Tiles & Connections">
    <h4>Tiles &amp; Connections</h4>
    <table><colgroup><col style={{ width: '23%' }}/><col style={{ width: '30%' }}/><col/></colgroup>
      <thead><tr><th scope="col">Tile ID</th><th scope="col">Profile</th><th scope="col">Connections</th></tr></thead>
      <tbody>{assembly.pieces.map(piece => {
        const selected = selection.kind === 'piece' && selection.id === piece.id
        const profile = assembly.profiles.find(s => s.profile.id === piece.profileId && s.profile.version === piece.profileVersion)
        return <tr key={piece.id} data-tile-row={piece.id} data-selected={selected} onClick={() => { if (!busy) select({ kind: 'piece', id: piece.id }) }}>
          <th scope="row"><button data-3d-piece={piece.id} disabled={busy} aria-pressed={selected}
            onClick={e => { e.stopPropagation(); select({ kind: 'piece', id: piece.id }) }}>{piece.id}</button></th>
          <td title={`${piece.profileId}@${piece.profileVersion}`}><span className="magnetic-3d-swatch" style={{ background: piece.color ?? '#55b8ac' }}/>{profile?.profile.name ?? piece.profileId}<small>{piece.profileId}@{piece.profileVersion}</small></td>
          <td><div className="magnetic-3d-table-connections">{assembly.connections.map((c, index) => {
            if (c.pieceA !== piece.id && c.pieceB !== piece.id) return null
            const neighbor = c.pieceA === piece.id ? c.pieceB : c.pieceA
            return <button key={index} data-3d-connection={index} disabled={busy}
              aria-label={`连接 #${index} · ${piece.id} → ${neighbor}`} aria-pressed={selection.kind === 'connection' && selection.index === index}
              title={`#${index} · ${c.pieceA}:${c.portA} → ${c.pieceB}:${c.portB} · ${c.dihedralDeg}° · flip ${c.flip ?? false}`}
              onClick={e => { e.stopPropagation(); select({ kind: 'connection', index }) }}>{neighbor}<small>#{index}</small></button>
          })}{!assembly.connections.some(c => c.pieceA === piece.id || c.pieceB === piece.id) && <span>—</span>}</div></td>
        </tr>
      })}</tbody>
    </table>
    {!assembly.pieces.length && <p className="hint">尚无零件；从 Edit Tools 添加。</p>}
  </section>
}
