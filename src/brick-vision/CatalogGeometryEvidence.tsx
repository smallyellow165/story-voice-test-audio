export type CatalogBodyMetadata = {
  status?: string; reason?: string; scope?: string; mapping?: unknown; candidates?: unknown
  width_studs?: { value: number | null; source: string; evidence: string; source_files?: unknown }
  depth_studs?: { value: number | null; source: string; evidence: string; source_files?: unknown }
  height_brick_units?: { value: number | null; source: string; evidence: string; source_files?: unknown }
}

export function CatalogGeometryEvidence({ geometry, checks }: { geometry?: CatalogBodyMetadata; checks?: unknown }) {
  return <div className="inventory-feature-evidence">
    <small>主体 W × D × H：{geometry?.width_studs?.value ?? 'Unknown'} × {geometry?.depth_studs?.value ?? 'Unknown'} × {geometry?.height_brick_units?.value ?? 'Unknown'}（Stud × Stud × Brick）</small>
    <details><summary>尺寸来源 / 匹配状态</summary><pre>{JSON.stringify({
      dimensions: geometry || { status: 'unknown', reason: '此结果未提供主体几何证据' }, checks,
      scope: 'Catalog 主体尺寸，不代表 Assembly 连接能力或实物公差验证',
    }, null, 2)}</pre></details>
  </div>
}
