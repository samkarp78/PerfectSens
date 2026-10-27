export interface Aim { yaw: number; pitch: number }                 // degrees; +yaw right, +pitch up; yaw unwrapped
export interface MoveSample { t: number; dx: number; dy: number }   // raw counts, t in ms
export interface AimSample { t: number; yaw: number; pitch: number }
export type FovType = 'horizontal' | 'vertical';
export type Mode = 'default' | 'thorough';
export interface Setup { dpi: number; cm360: number; inGameSens: number | null; fov: number; fovType: FovType; mode: Mode }
