import { useEffect, useRef, useState } from 'preact/hooks';
import './styles.css';
import { defaultConfig } from '../core/config';
import type { SessionState } from '../core/session';
import { FlickRunner } from '../core/run/flickRunner';
import { TrackingRunner } from '../core/run/trackingRunner';
import { requestRawPointerLock, startCapture } from '../input/rawInput';
import { createScene } from '../scene/scene';
import { offscreenArrow } from '../scene/camera';
import { vfovDeg } from '../core/geometry';
import type { Aim } from '../core/types';
import { createRunController, type RunController, type RunPhase } from './runController';

export interface RunProps {
  session: SessionState;
  onFinished(state: SessionState): void;
  onUnsupported(): void;
  onQuit(): void;
}

interface View { phase: RunPhase; hud: string; restText: string; done: number; total: number }

const LOCK_DENIED_TEXT = 'Click again to lock the mouse.';
const PAUSED_TEXT = 'Paused — this block will restart.';
/** How long the quit button stays armed waiting for the confirming click. */
const QUIT_CONFIRM_MS = 3000;
const viewOf = (c: RunController): View => {
  const p = c.session.progress;
  return { phase: c.phase, hud: c.hud, restText: c.restText, done: p?.blocksDone ?? 0, total: p?.blocksTotal ?? 0 };
};
/** Arrow sits on an ellipse this fraction of the half-width/height from the centre. */
const ARROW_RING = 0.38;

export function Run({ session, onFinished, onUnsupported, onQuit }: RunProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const arrowRef = useRef<HTMLDivElement>(null);
  const ctrlRef = useRef<RunController | null>(null);
  if (!ctrlRef.current) ctrlRef.current = createRunController(session);
  const ctrl = ctrlRef.current;
  const [view, setView] = useState<View>(() => viewOf(ctrl));
  const [denied, setDenied] = useState(false);
  const [quitArmed, setQuitArmed] = useState(false);
  useEffect(() => {
    if (!quitArmed) return;
    const id = setTimeout(() => setQuitArmed(false), QUIT_CONFIRM_MS);
    return () => clearTimeout(id);
  }, [quitArmed]);
  const cbRef = useRef({ onFinished, onUnsupported });
  cbRef.current = { onFinished, onUnsupported };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const { setup } = ctrl.session;
    const scene = createScene(canvas, {
      fov: setup.fov, fovType: setup.fovType, targetRadiusDeg: defaultConfig.flick.targetRadiusDeg,
      trackingRadiusDeg: defaultConfig.tracking.targetRadiusDeg,
    });
    const showArrow = (aim: Aim, target: Aim | null) => {
      const el = arrowRef.current;
      if (!el) return;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      const a = target && w > 0 && h > 0 ? offscreenArrow(aim, target, vfovDeg(setup.fov, setup.fovType, w / h), w / h) : null;
      if (a === null) { el.style.display = 'none'; return; }
      el.style.display = 'block';
      el.style.left = `${w / 2 + Math.cos(a) * w * ARROW_RING}px`;
      el.style.top = `${h / 2 - Math.sin(a) * h * ARROW_RING}px`;
      el.style.transform = `translate(-50%, -50%) rotate(${-a}rad)`;
    };
    const fit = () => scene.resize(canvas.clientWidth, canvas.clientHeight);
    fit();
    window.addEventListener('resize', fit);

    let last: View = viewOf(ctrl);
    const sync = () => {
      const v = viewOf(ctrl);
      if (v.phase !== last.phase || v.hud !== last.hud || v.restText !== last.restText || v.done !== last.done) {
        const wasRunning = last.phase === 'running';
        last = v;
        setView(v);
        if (wasRunning && v.phase !== 'running' && document.pointerLockElement) document.exitPointerLock();
        if (v.phase === 'finished') cbRef.current.onFinished(ctrl.session);
      }
    };
    const dispose = startCapture(
      document,
      (s) => { ctrl.onMove(s); sync(); },
      (t) => { ctrl.onClick(t); sync(); },
      () => { ctrl.onLockLost(); sync(); },
      (t) => { ctrl.onRelease(t); },
    );

    if (last.phase === 'finished') cbRef.current.onFinished(ctrl.session);

    let raf = 0;
    let disposed = false;
    const frame = () => {
      if (disposed) return;
      ctrl.tick(performance.now());
      sync();
      const r = ctrl.runner;
      if (r instanceof FlickRunner) {
        const st = r.state;
        scene.setAim(st.aim);
        scene.setFlickTarget(st.target?.aim ?? null);
        scene.setTrackingTarget(null, false);
        showArrow(st.aim, st.target?.aim ?? null);
      } else if (r instanceof TrackingRunner) {
        const st = r.state;
        scene.setAim(st.aim);
        scene.setFlickTarget(null);
        scene.setTrackingTarget(st.targetAim, st.onTarget);
        showArrow(st.aim, st.targetAim);
      } else {
        showArrow({ yaw: 0, pitch: 0 }, null);
        scene.setFlickTarget(null);
        scene.setTrackingTarget(null, false);
      }
      scene.render();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', fit);
      dispose();
      if (document.pointerLockElement) document.exitPointerLock();
      scene.dispose();
    };
  }, []);

  const start = async () => {
    const canvas = canvasRef.current!;
    const result = await requestRawPointerLock(canvas);
    if (result === 'unsupported') { cbRef.current.onUnsupported(); return; }
    if (result === 'denied') { setDenied(true); return; }
    setDenied(false);
    ctrl.begin(performance.now());
    setView(viewOf(ctrl));
  };

  const skip = (e: Event) => {
    e.stopPropagation();
    ctrl.skipWarmup();
    setView(viewOf(ctrl));
  };

  const card = view.phase === 'rest' || view.phase === 'paused';
  const warmup = view.phase === 'rest' && view.hud === 'Warm-up';

  return (
    <div class="run">
      <canvas ref={canvasRef} class="run-canvas" />
      {view.phase === 'running' && <div class="crosshair" aria-hidden="true" />}
      <div class="hud">{view.hud}</div>
      {view.total > 0 && (
        <div class="progress" role="progressbar" aria-label="Session progress"
          aria-valuemin={0} aria-valuemax={view.total} aria-valuenow={view.done}>
          <div class="progress-fill" style={{ width: `${Math.max(1, Math.min(100, (100 * view.done) / view.total))}%` }} />
        </div>
      )}
      {view.total > 0 && view.hud !== 'Warm-up' && (
        <div class="progress-count">Block {Math.min(view.done + 1, view.total)} / ~{view.total}</div>
      )}
      <div ref={arrowRef} class="offscreen-arrow" aria-hidden="true" />
      {card && (
        <div class="rest-overlay">
          <div class="rest-card" role="button" tabIndex={0} onClick={start}
            onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) void start(); }}>
            {view.total > 0 && view.hud !== 'Warm-up' && (
              <p class="rest-progress">{Math.round((100 * view.done) / view.total)}% done · block {Math.min(view.done + 1, view.total)} of about {view.total}</p>
            )}
            <p class="rest-text">{view.phase === 'paused' ? PAUSED_TEXT : view.restText}</p>
            <p class="rest-cta">Click to start</p>
            {denied && <p class="rest-warn">{LOCK_DENIED_TEXT}</p>}
            {warmup && <button type="button" class="rest-skip" onClick={skip}>Skip warm-up</button>}
          </div>
          <button type="button" class={quitArmed ? 'quit quit-armed' : 'quit'}
            onClick={(e) => { e.stopPropagation(); if (quitArmed) onQuit(); else setQuitArmed(true); }}>
            {quitArmed ? 'Click again to quit (progress is lost)' : 'Quit test'}
          </button>
        </div>
      )}
    </div>
  );
}
