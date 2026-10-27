import type { FlickSummary, TrialMetrics } from './measure/flick';
import type { TrackingSummary } from './measure/tracking';
import type { StepScore } from './score';

export interface Aim { yaw: number; pitch: number }                 // degrees; +yaw right, +pitch up; yaw unwrapped
export interface MoveSample { t: number; dx: number; dy: number }   // raw counts, t in ms
export interface AimSample { t: number; yaw: number; pitch: number }
export type FovType = 'horizontal' | 'vertical';
export type Mode = 'default' | 'thorough';
export interface Setup { dpi: number; cm360: number; inGameSens: number | null; fov: number; fovType: FovType; mode: Mode }
export type Stage = 'warmup' | 'baseline' | 'dialin' | 'recheck' | 'ab';
export type BlockKind = 'warmup' | 'flick' | 'tracking';
export type Arm = 'P' | 'C';                        // pick / current
export type FlickClass = 'small' | 'medium' | 'big';
export interface BlockSpec { id: string; stage: Stage; kind: BlockKind; cm360: number; seed: number; stepIndex: number; arm: Arm | null }
export interface FlickTarget { index: number; aim: Aim; distance: number; cls: FlickClass; scored: boolean }
export interface FlickClick { t: number; aim: Aim; hit: boolean }
export interface FlickTrial { target: FlickTarget; spawnT: number; spawnAim: Aim; clicks: FlickClick[]; hitT: number | null; timedOut: boolean }
export interface FlickBlockLog { spec: BlockSpec; t0: number; trials: FlickTrial[]; path: AimSample[] }
export interface TrackingBlockLog { spec: BlockSpec; t0: number; endT: number; path: AimSample[] }
export interface StepResult { order: number; stage: Exclude<Stage, 'warmup'>; arm: Arm | null; cm360: number;
  trials: TrialMetrics[]; flick: FlickSummary; tracking: TrackingSummary; score: StepScore }
