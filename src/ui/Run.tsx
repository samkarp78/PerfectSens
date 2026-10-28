import { useEffect, useRef, useState } from 'preact/hooks';
import './styles.css';
import { defaultConfig } from '../core/config';
import type { SessionState } from '../core/session';
import { FlickRunner } from '../core/run/flickRunner';
import { TrackingRunner } from '../core/run/trackingRunner';
import { requestRawPointerLock, startCapture } from '../input/rawInput';
import { createScene } from '../scene/scene';
import { createRunController, type RunController, type RunPhase } from './runController';

export interface RunProps {
  session: SessionState;
  onFinished(state: SessionState): void;
  onUnsupported(): void;
  onQuit(): void;
}

interface View { phase: RunPhase; hud: string; restText: string }

const LOCK_DENIED_TEXT = 'Click again to lock the mouse.';
const PAUSED_TEXT = 'Paused — this block will restart.';
const viewOf = (c: RunController): View => ({ phase: c.phase, hud: c.hud, restText: c.restText });

export function Run({ session, onFinished, onUnsupported, onQuit }: RunProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctrlRef = useRef<RunController | null>(null);
  if (!ctrlRef.current) ctrlRef.current = createRunController(session);
  const ctrl = ctrlRef.current;
  const [view, setView] = useState<View>(() => viewOf(ctrl));
  const [denied, setDenied] = useState(false);
  const cbRef = useRef({ onFinished, onUnsupported });
  cbRef.current = { onFinished, onUnsupported };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const { setup } = ctrl.session;
    const scene = createScene(canvas, {
      fov: setup.fov, fovType: setup.fovType, targetRadiusDeg: defaultConfig.flick.targetRadiusDeg,
    });
    const fit = () => scene.resize(canvas.clientWidth, canvas.clientHeight);
    fit();
    window.addEventListener('resize', fit);

    let last: View = viewOf(ctrl);
    const sync = () => {
      const v = viewOf(ctrl);
      if (v.phase !== last.phase || v.hud !== last.hud || v.restText !== last.restText) {
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
      } else if (r instanceof TrackingRunner) {
        const st = r.state;
        scene.setAim(st.aim);
        scene.setFlickTarget(null);
        scene.setTrackingTarget(st.targetAim, st.onTarget);
      } else {
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
      {card && (
        <div class="rest-overlay">
          <div class="rest-card" role="button" tabIndex={0} onClick={start}
            onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) void start(); }}>
            <p class="rest-text">{view.phase === 'paused' ? PAUSED_TEXT : view.restText}</p>
            <p class="rest-cta">Click to start</p>
            {denied && <p class="rest-warn">{LOCK_DENIED_TEXT}</p>}
            {warmup && <button type="button" class="rest-skip" onClick={skip}>Skip warm-up</button>}
            <button type="button" class="rest-skip" onClick={(e) => { e.stopPropagation(); onQuit(); }}>Quit test</button>
          </div>
        </div>
      )}
    </div>
  );
}
