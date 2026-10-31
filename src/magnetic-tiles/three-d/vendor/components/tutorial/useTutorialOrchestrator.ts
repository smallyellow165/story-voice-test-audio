/**
 * P1: 教学编排 React Hook
 *
 * 把 orchestrator.ts 的纯状态机包装为可用的 React Hook，
 * 通过 requestAnimationFrame 驱动每帧 tick。
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import type { BuildStepV2 } from './types.ts';
import {
  type OrchestratorState,
  type OrchestratorAction,
  createOrchestratorState,
  tick,
  reduce,
} from './orchestrator.ts';

export interface UseOrchestratorOptions {
  /** 初始步骤索引 */
  initialStep?: number;
  /** 总步骤数 */
  totalSteps: number;
  /** 是否启用 reduced-motion（默认自动检测 prefers-reduced-motion） */
  reducedMotion?: boolean;
  /** 自动播放下一步的延迟（毫秒，0 = 不自动播放） */
  autoNextMs?: number;
}

export interface UseOrchestratorResult {
  state: OrchestratorState;
  /** 当前步骤数据（由调用方提供） */
  setStep: (step: BuildStepV2 | undefined) => void;
  /** 派发动作 */
  dispatch: (action: OrchestratorAction) => void;
  /** 跳转到指定步骤 */
  seek: (stepIndex: number) => void;
  /** 便捷方法 */
  play: () => void;
  pause: () => void;
  replayStep: () => void;
  next: () => void;
  prev: () => void;
  toggleLockView: () => void;
}

export function useTutorialOrchestrator(
  steps: BuildStepV2[],
  options: UseOrchestratorOptions,
): UseOrchestratorResult {
  const { initialStep = 0, totalSteps, autoNextMs = 0 } = options;

  // 自动检测 prefers-reduced-motion
  const prefersReducedMotion = useRef(false);
  if (typeof window !== 'undefined' && window.matchMedia) {
    prefersReducedMotion.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  const reducedMotion = options.reducedMotion ?? prefersReducedMotion.current;

  const [stepRef, setStepRef] = useState<BuildStepV2 | undefined>(undefined);
  const [state, setState] = useState<OrchestratorState>(() =>
    createOrchestratorState(initialStep, steps[initialStep], reducedMotion),
  );

  // 同步 step 数据到 ref
  const setStep = useCallback((step: BuildStepV2 | undefined) => {
    setStepRef(step);
  }, []);

  // 作者修改 steps 时重置到选中步；单纯回报播放位置不重置动画。
  useEffect(() => {
    setState(createOrchestratorState(initialStep, steps[initialStep], reducedMotion));
    setStepRef(steps[initialStep]);
  }, [steps, reducedMotion]);

  // RAF 循环
  const lastTimeRef = useRef<number | null>(null);
  useEffect(() => {
    if (state.playState !== 'playing') {
      lastTimeRef.current = null;
      return;
    }
    let rafId = 0;
    const loop = (now: number) => {
      if (lastTimeRef.current === null) lastTimeRef.current = now;
      const dt = now - lastTimeRef.current;
      lastTimeRef.current = now;
      setState((s) => tick(s, dt, steps[s.currentStep], totalSteps));
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [state.playState, steps, totalSteps]);

  // 自动播放下一步（仅当 autoNextMs > 0 且当前步骤完成）
  useEffect(() => {
    if (autoNextMs <= 0) return;
    if (state.playState !== 'idle') return;
    if (state.elapsedInStepMs < state.stepTotalMs) return;
    if (state.currentStep >= totalSteps - 1) return;
    const timer = setTimeout(() => {
      setState((s) =>
        reduce(s, { type: 'next' }, totalSteps, steps[Math.min(s.currentStep+1,totalSteps-1)]),
      );
    }, autoNextMs);
    return () => clearTimeout(timer);
  }, [state.playState, state.elapsedInStepMs, state.stepTotalMs, state.currentStep, autoNextMs, totalSteps, steps]);

  const dispatch = useCallback((action: OrchestratorAction) => {
    setState((s) => {
      const index = action.type === 'seek' ? Math.max(0,Math.min(action.stepIndex,totalSteps-1))
        : action.type === 'next' ? Math.min(s.currentStep+1,totalSteps-1)
        : action.type === 'prev' ? Math.max(s.currentStep-1,0) : s.currentStep;
      const step=steps[index];
      if(action.type==='play' && s.elapsedInStepMs>=s.stepTotalMs) return reduce(s,{type:'replay-step'},totalSteps,step);
      return reduce(s,action,totalSteps,step);
    });
  }, [totalSteps, steps]);
  const seek = useCallback((stepIndex:number) => dispatch({type:'seek',stepIndex}),[dispatch]);

  const play = useCallback(() => dispatch({ type: 'play' }), [dispatch]);
  const pause = useCallback(() => dispatch({ type: 'pause' }), [dispatch]);
  const replayStep = useCallback(() => dispatch({ type: 'replay-step' }), [dispatch]);
  const next = useCallback(() => dispatch({ type: 'next' }), [dispatch]);
  const prev = useCallback(() => dispatch({ type: 'prev' }), [dispatch]);
  const toggleLockView = useCallback(() => {
    setState((s) => reduce(s, { type: 'lock-view', locked: !s.lockedView }, totalSteps, stepRef));
  }, [totalSteps, steps]);

  // 当 currentStep 变化时，更新 stepRef
  useEffect(() => {
    if (steps[state.currentStep] !== stepRef) {
      setStepRef(steps[state.currentStep]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.currentStep, steps]);

  return {
    state,
    setStep,
    dispatch,
    seek,
    play,
    pause,
    replayStep,
    next,
    prev,
    toggleLockView,
  };
}
