import { createBaselineJumpStrategy } from './jump-baseline-strategy.ts'
import { createDinoJumpStrategy } from './jump-dino-strategy.ts'
import { createJumpCountStrategy } from './jump-count-strategy.ts'
import { createJumpCountOriginalStrategy } from './jump-count-original-strategy.ts'
import type { JumpSnapshot } from './jump-strategy'

export const JUMP_STRATEGIES = [
  { name: 'Standing foot baseline V1', create: createBaselineJumpStrategy,
    help: '先直立站稳约 1 秒建立基线；换位置后 Reset。completed 才表示完整周期事件。' },
  { name: 'Dino Jump', create: createDinoJumpStrategy,
    help: '无需站立校准。双肩上升速度 / 肩宽，EMA 后 > 2.5；每次越过阈值产生事件，不判断落地。' },
  { name: 'Jump Count', create: createJumpCountStrategy,
    help: '无需站立校准。躯干 30 帧历史及峰值信号；只有正 → 负转换产生事件，不判断落地。' },
  { name: 'Jump Count Original', create: createJumpCountOriginalStrategy,
    help: '忠实原版：30 帧滚动历史、Detector(30, 1.0)、visibility ≥ 0.75、正 → 负事件。空帧/时间间隔不清空历史；Reset 重新初始化。' },
]

// Only the comparison result is shared; strategy-specific phases stay intact.
export function jumpResult(snapshot: JumpSnapshot) {
  return {
    detected: ['JUMP', 'TAKEOFF', 'AIRBORNE', 'LANDING'].includes(snapshot.state),
    event: snapshot.event?.type === 'detected' || snapshot.event?.type === 'completed',
  }
}
