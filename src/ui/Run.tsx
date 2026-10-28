import { useEffect, useRef, useState } from 'preact/hooks';
import './styles.css';
import { defaultConfig } from '../core/config';
import type { SessionState } from '../core/session';
import { FlickRunner } from '../core/run/flickRunner';
import { SwitchRunner } from '../core/run/switchRunner';
import { TrackingRunner } from '../core/run/trackingRunner';
import { requestRawPointerLock, startCapture } from '../input/rawInput';
import { createScene } from '../scene/scene';
import { offscreenArrow } from '../scene/camera';
import { angleBetween, vfovDeg } from '../core/geometry';
import type { Aim } from '../core/types';
import { createRunController, type Runner, type RunController, type RunPhase } from './runController';
import { createScoreKeeper, flickEvents, gradeFor, switchEvents, type ScoreState } from './scoreKeeper';
import { createSounds } from './sound';
import { AskCard, BreakCard, Countdown, type BreakStats } from './RunCards';
import type { Prefs } from '../store/prefs';

export interface RunProps {
  session: SessionState;
  prefs: Prefs;
  onFinished(state: SessionState, stats: ScoreState): void;
  onUnsupported(): void;
  onQuit(): void;
}

interface View { phase: RunPhase; hud: string; restText: string; done: number; total: number }

const LOCK_DENIED_TEXT = 'Click again to lock the mouse.';
const PAUSED_TEXT = 'Paused — this part will restart.';
/** How long the quit button stays armed waiting for the confirming click. */
const QUIT_CONFIRM_MS = 3000;
/** Seconds counted down before the next round starts on its own (while the mouse stays locked). */
const COUNTDOWN_S = 3;
/** Tracking tick sound interval while the target is held. */
const TICK_MS = 125;
/** Blocks per round (flicks, switching, tracking). */
const PER_ROUND = 3;
/** Arrow sits on an ellipse this fraction of the half-width/height from the centre. */
const ARROW_RING = 0.38;

const viewOf = (c: RunController): View => {
  const p = c.session.progress;
  return { phase: c.phase, hud: c.hud, restText: c.restText, done: p?.blocksDone ?? 0, total: p?.blocksTotal ?? 0 };
};
const partName = (r: Runner): string => (r instanceof TrackingRunner ? 'Tracking' : r instanceof SwitchRunner ? 'Switching' : 'Flicks');
const clock = (ms: number): string => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function Run({ session, prefs, onFinished, onUnsupported, onQuit }: RunProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const arrowRef = useRef<HTMLDivElement>(null);
  const holdRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<HTMLDivElement>(null);
  const scoreRef = useRef<HTMLDivElement>(null);
  const ctrlRef = useRef<RunController | null>(null);
  if (!ctrlRef.current) ctrlRef.current = createRunController(session);
  const ctrl = ctrlRef.current;
  const keeper = useRef(createScoreKeeper()).current;
  const sounds = useRef(createSounds(prefs.sound)).current;
  const [view, setView] = useState<View>(() => viewOf(ctrl));
  const [denied, setDenied] = useState(false);
  const [quitArmed, setQuitArmed] = useState(false);
  const [locked, setLocked] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [breakStats, setBreakStats] = useState<BreakStats | null>(null);

  // While the mouse stays locked between rounds, count down and start the next round on its own.
  useEffect(() => {
    if (view.phase !== 'rest' || !locked) { setCountdown(null); return; }
    let left = COUNTDOWN_S;
    setCountdown(left);
    sounds.countdown(false);
    const id = setInterval(() => {
      left--;
      if (left > 0) { setCountdown(left); sounds.countdown(false); return; }
      clearInterval(id);
      setCountdown(null);
      sounds.countdown(true);
      ctrl.begin(performance.now());
      setView(viewOf(ctrl));
    }, 1000);
    return () => clearInterval(id);
  }, [view.phase, view.done, locked]);
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
        if (v.phase === 'break') {
          const every = ctrl.session._cfg.session.breakEveryRounds;
          const recent = ctrl.session.steps.slice(-every);
          const mean = recent.reduce((s, st) => s + st.score.logS, 0) / Math.max(1, recent.length);
          setBreakStats({ ...keeper.stretch(), grade: gradeFor(mean) });
        }
        setView(v);
        // Between rounds the lock is kept for the countdown (unless auto-continue is off); it is released for
        // breaks, questions and the end.
        const release = v.phase === 'break' || v.phase === 'asking' || v.phase === 'finished' || (v.phase === 'rest' && !prefs.autoContinue);
        if (wasRunning && release && document.pointerLockElement) document.exitPointerLock();
        if (v.phase === 'finished') cbRef.current.onFinished(ctrl.session, keeper.state);
      }
    };
    const dispose = startCapture(
      document,
      (s) => { ctrl.onMove(s); sync(); },
      (t) => { ctrl.onClick(t); sync(); },
      () => { setLocked(false); ctrl.onLockLost(); sync(); },
      (t) => { ctrl.onRelease(t); },
    );

    if (last.phase === 'finished') cbRef.current.onFinished(ctrl.session, keeper.state);

    // Turns runner progress into points, sounds and hit effects (display only).
    let seen: Runner | null = null;
    let cursor = 0, kills = 0, lastFrame = performance.now(), lastTick = 0, scoreText = '';
    const feedback = (r: Runner | null, now: number) => {
      if (r !== seen) { seen = r; cursor = 0; kills = 0; }
      if (r instanceof FlickRunner && r.log().spec.kind === 'warmup') {
        // warm-up: no points
      } else if (r instanceof FlickRunner) {
        const trials = r.log().trials;
        const { events, next } = flickEvents(trials, cursor);
        for (let i = cursor; i < next; i++) if (trials[i]!.hitT !== null) scene.popAt(trials[i]!.target.aim);
        cursor = next;
        for (const e of events) { if (e.hit) { keeper.hit(e.ms); sounds.hit(keeper.state.streak - 1); } else { keeper.miss(); sounds.miss(); } }
      } else if (r instanceof SwitchRunner) {
        const log = r.log();
        const { events, next } = switchEvents(log, cursor);
        cursor = next;
        for (; kills < log.kills.length; kills++) scene.popAt(log.kills[kills]!.target);
        for (const e of events) { if (e.hit) { keeper.hit(e.ms); sounds.hit(keeper.state.streak - 1); } else { keeper.miss(); sounds.miss(); } }
      } else if (r instanceof TrackingRunner) {
        const on = r.state.onTarget && now >= r.state.scoredFrom;
        keeper.track(now - lastFrame, on);
        if (on && now - lastTick >= TICK_MS) { sounds.tick(); lastTick = now; }
      }
      const st = keeper.state;
      const text = `${st.points.toLocaleString()} pts${st.streak >= 2 ? ` · ×${st.streak} streak` : ''}`;
      if (text !== scoreText && scoreRef.current) { scoreRef.current.textContent = text; scoreText = text; }
    };

    let raf = 0;
    let disposed = false;
    const frame = () => {
      if (disposed) return;
      const now = performance.now();
      ctrl.tick(now);
      const r = ctrl.runner;
      feedback(r, now);
      sync();
      lastFrame = now;
      if (holdRef.current) holdRef.current.style.display = r instanceof TrackingRunner && !r.state.held ? 'block' : 'none';
      if (timerRef.current) {
        const ready = r instanceof TrackingRunner && now < r.state.scoredFrom;
        timerRef.current.textContent = r ? `${partName(r)} · ${ready ? 'get ready' : clock(r.state.endsAt - now)}` : '';
      }
      scene.setFlickTarget(r instanceof FlickRunner ? (r.state.target?.aim ?? null) : null);
      scene.setSwitchTargets(r instanceof SwitchRunner ? r.state.targets : []);
      scene.setTrackingTarget(r instanceof TrackingRunner ? r.state.targetAim : null, r instanceof TrackingRunner && r.state.onTarget);
      if (r) {
        scene.setAim(r.state.aim);
        const aim = r.state.aim;
        const target = r instanceof FlickRunner ? (r.state.target?.aim ?? null)
          : r instanceof TrackingRunner ? r.state.targetAim
          : [...r.state.targets].sort((a, b) => angleBetween(aim, a) - angleBetween(aim, b))[0] ?? null;
        showArrow(aim, target);
      } else {
        showArrow({ yaw: 0, pitch: 0 }, null);
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
    setLocked(true);
    ctrl.begin(performance.now());
    setView(viewOf(ctrl));
  };

  const skip = (e: Event) => {
    e.stopPropagation();
    ctrl.skipWarmup();
    setView(viewOf(ctrl));
  };

  const card = (view.phase === 'rest' && !locked) || view.phase === 'paused';
  const answer = (accept: boolean) => { ctrl.answerExtension(accept); setView(viewOf(ctrl)); };
  const warmup = view.phase === 'rest' && view.hud === 'Warm-up';
  const rounds = view.total / PER_ROUND;
  const round = Math.min(Math.floor(view.done / PER_ROUND) + 1, rounds);
  const quit = (
    <button type="button" class={quitArmed ? 'quit quit-armed' : 'quit'}
      onClick={(e) => { e.stopPropagation(); if (quitArmed) onQuit(); else setQuitArmed(true); }}>
      {quitArmed ? 'Click again to quit (progress is lost)' : 'Quit test'}
    </button>
  );

  return (
    <div class="run">
      <canvas ref={canvasRef} class="run-canvas" />
      {view.phase === 'running' && <div class="crosshair" aria-hidden="true" />}
      <div class="hud">{view.hud}</div>
      <div ref={timerRef} class="part-timer" aria-live="off" />
      <div ref={scoreRef} class="score-hud" aria-live="off" />
      {view.total > 0 && (
        <div class="progress" role="progressbar" aria-label="Session progress"
          aria-valuemin={0} aria-valuemax={view.total} aria-valuenow={view.done}>
          <div class="progress-fill" style={{ width: `${Math.max(1, Math.min(100, (100 * view.done) / view.total))}%` }} />
        </div>
      )}
      {view.total > 0 && view.hud !== 'Warm-up' && <div class="progress-count">Round {round} / ~{rounds}</div>}
      <div ref={arrowRef} class="offscreen-arrow" aria-hidden="true" />
      <div ref={holdRef} class="hold-prompt" aria-live="polite">Hold the mouse button and track</div>
      {countdown !== null && <Countdown text={view.restText} n={countdown} />}
      {view.phase === 'asking' && <AskCard onAnswer={answer} />}
      {view.phase === 'break' && (
        <div class="rest-overlay">
          <BreakCard stats={breakStats} onContinue={() => void start()} />
          {denied && <p class="rest-warn">{LOCK_DENIED_TEXT}</p>}
          {quit}
        </div>
      )}
      {card && (
        <div class="rest-overlay">
          <div class="rest-card" role="button" tabIndex={0} onClick={start}
            onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) void start(); }}>
            {view.total > 0 && view.hud !== 'Warm-up' && (
              <p class="rest-progress">{Math.round((100 * view.done) / view.total)}% done · round {round} of about {rounds}</p>
            )}
            <p class="rest-text">{view.phase === 'paused' ? PAUSED_TEXT : view.restText}</p>
            <p class="rest-cta">Click to start</p>
            {denied && <p class="rest-warn">{LOCK_DENIED_TEXT}</p>}
            {warmup && <button type="button" class="rest-skip" onClick={skip}>Skip warm-up</button>}
          </div>
          {quit}
        </div>
      )}
    </div>
  );
}
