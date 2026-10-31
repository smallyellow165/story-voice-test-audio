// MIT upstream BuildStepV2, camera and animation types, extracted unchanged.
import type { Connection } from "../../engine/types.ts";

/** 新版搭建步骤 */
export interface BuildStepV2 {
  id: number;
  title: string;
  description: string;
  parentGuide: string;
  /** 本步骤新增的 piece id 列表 */
  addedPieceIds: string[];
  /** 本步骤新增的连接关系 */
  addedConnections: Connection[];
  /* ----------------- P1: 教学编排字段（全部可选，旧数据自动获得默认值） ----------------- */
  /** 本步镜头（若未设置，播放器保持上一镜头或使用默认镜头） */
  camera?: StepCamera;
  /** 每片零件的入场配置（按 pieceId 索引） */
  entrance?: Record<string, PieceEntranceConfig>;
  /** 新零件的短暂高亮时间（毫秒，0 = 不高亮），默认 600ms */
  highlightMs?: number;
  /** 吸附完成时的反馈类型 */
  snapFeedback?: 'none' | 'pulse' | 'glow';
  /** 可选的零件标注（按 pieceId 索引，文本内容） */
  annotations?: Record<string, string>;
  /** 本步提示文字（显示在播放器侧栏） */
  hint?: string;
  /** 本步观察重点（显示在播放器侧栏） */
  focusPoints?: string[];
}

/** 步骤镜头：作者保存的本步视角 */
export interface StepCamera {
  /** 镜头位置 */
  position: [number, number, number];
  /** 镜头看向的目标点 */
  target: [number, number, number];
  /** 缩放（OrthographicCamera zoom，或透视相机的 dolly 距离参考） */
  zoom: number;
  /** 镜头过渡时长（毫秒，0 = 瞬切） */
  transitionMs: number;
}

/** 入场类型 */
export type EntranceType =
  | 'drop'      // 上方飞入
  | 'side'      // 侧面飞入
  | 'fold'      // 折叠
  | 'fade'      // 原位淡入
  | 'none';     // 无动画（直接显示）

/** 单片零件的入场动画配置 */
export interface PieceEntranceConfig {
  /** 入场类型，默认 'drop' */
  type: EntranceType;
  /** 相对步骤开始的延迟（毫秒），默认 0 */
  delayMs: number;
  /** 动画时长（毫秒），默认 800 */
  durationMs: number;
  /** 缓动函数名称，默认 'easeOutCubic' */
  easing: EasingName;
  /** 起始位移偏移（局部坐标，相对最终位置） */
  startOffset?: [number, number, number];
  /** 起始旋转偏移（欧拉角弧度，相对最终旋转） */
  startRotation?: [number, number, number];
}

/** 支持的缓动函数名称 */
export type EasingName =
  | 'linear'
  | 'easeOutCubic'
  | 'easeInOutCubic'
  | 'easeOutBack'
  | 'easeOutBounce'
  | 'easeOutElastic';

