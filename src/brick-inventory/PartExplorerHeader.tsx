import {InfoHint} from '../brick-vision/InfoHint'

export function PartExplorerHeader() {
  return <header className="inventory-source-header">
    <h1><a href={location.pathname}>LEGO Part Explorer</a></h1>
    <InfoHint label="LEGO Part Explorer">IMAGE → RECOGNITION → MATCH。识别图片中的构件、分析几何、匹配 Catalog 并确认零件。当前 Catalog 范围为 DUPLO。点击标题返回本页无参数入口。</InfoHint>
  </header>
}
