import { useEffect, useRef, useState } from 'preact/hooks';
import './styles.css';
import { defaultConfig } from '../core/config';
import { BLOCKS_PER_STEP, type SessionState } from '../core/session';
import { FlickRunner } from '../core/run/flickRunner';
import { SwitchRunner } from '../core/run/switchRunner';
import { TrackingRunner } from '../core/run/trackingRunner';
import { TrackSwitchRunner } from '../core/run/trackSwitchRunner';
import { requestRawPointerLock, startCapture } from '../input/rawInput';
import { createScene } from '../scene/scene';
import { offscreenArrow } from '../scene/camera';
import { angleBetween, vfovDeg } from '../core/geometry';
import type { Aim } from '../core/types';
import { countdownBeep, createRunController, cueText, type Runner, type RunController, type RunPhase } from './runController';
import { createScoreKeeper, flickEvents, gradeFor, switchEvents, trackSwitchEvents, type ScoreState } from './scoreKeeper';
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
/** Tick sound interval while a tracking target is held (or a tracking-switching target takes damage). */
const TICK_MS = 125;
/** Arrow sits on an ellipse this fraction of the half-width/height from the centre. */
const ARROW_RING = 0.38;
/** The part timer turns orange for the last few seconds. */
const TIMER_ENDING_MS = 5000;

const viewOf = (c: RunController): View => {
  const p = c.session.progress;
  return { phase: c.phase, hud: c.hud, restText: c.restText, done: p?.blocksDone ?? 0, total: p?.blocksTotal ?? 0 };
};
const partName = (r: Runner): string => (r instanceof TrackSwitchRunner ? 'Tracking switching' : r instanceof TrackingRunner ? 'Tracking'
  : r instanceof SwitchRunner ? 'Switching' : r.log().spec.kind === 'warmup' ? 'Warm-up' : 'Flicks');
const clock = (ms: number): string => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const nearest = (aim: Aim, targets: readonly Aim[]): Aim | null =>
  [...targets].sort((a, b) => angleBetween(aim, a) - angleBetween(aim, b))[0] ?? null;

export function Run({ session, prefs, onFinished, onUnsupported, onQuit }: RunProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const arrowRef = useRef<HTMLDivElement>(null);
  const holdRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<HTMLDivElement>(null);
  const timerNameRef = useRef<HTMLDivElement>(null);
  const timerNumRef = useRef<HTMLDivElement>(null);
  const timerBarRef = useRef<HTMLDivElement>(null);
  const cueRef = useRef<HTMLDivElement>(null);
  const cueTextRef = useRef<HTMLParagraphElement>(null);
  const cueNumRef = useRef<HTMLParagraphElement>(null);
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
    if (view.phase !== 'rest' || !locked || !prefs.autoContinue) { setCountdown(null); return; }
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
    const cfg = ctrl.session._cfg;
    const scene = createScene(canvas, {
      fov: setup.fov, fovType: setup.fovType, targetRadiusDeg: defaultConfig.flick.targetRadiusDeg,
      trackingRadiusDeg: defaultConfig.tracking.targetRadiusDeg, switchRadiusDeg: defaultConfig.switch.targetRadiusDeg,
      trackSwitchRadiusDeg: defaultConfig.trackswitch.targetRadiusDeg,
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
      // Cheap checks first: the rest text is only rebuilt when something it depends on changed.
      const p = ctrl.session.progress;
      if (ctrl.phase === last.phase && ctrl.hud === last.hud && (p?.blocksDone ?? 0) === last.done) return;
      const v = viewOf(ctrl);
      const wasRunning = last.phase === 'running' || last.phase === 'cue';
      last = v;
      if (v.phase === 'break') {
        const every = ctrl.session._cfg.session.breakEveryRounds;
        const recent = ctrl.session.steps.slice(-every);
        const mean = recent.reduce((s, st) => s + st.score.logS, 0) / Math.max(1, recent.length);
        setBreakStats({ ...keeper.stretch(), grade: ctrl.session.mode === 'quickab' ? null : gradeFor(mean) });
      }
      setView(v);
      // Between rounds the lock is kept for the countdown (unless auto-continue is off); it is released for
      // breaks, questions and the end.
      const release = v.phase === 'break' || v.phase === 'asking' || v.phase === 'finished' || (v.phase === 'rest' && !prefs.autoContinue);
      if (wasRunning && release && document.pointerLockElement) document.exitPointerLock();
      if (v.phase === 'finished') cbRef.current.onFinished(ctrl.session, keeper.state);
    };

    // Turns runner progress into points, sounds and hit effects (display only). A part that just ended is read one
    // last time, so its final hits still score.
    let seen: Runner | null = null;
    let cursor = 0, kills = 0, lastFrame = performance.now(), lastTick = 0, scoreText = '';
    let flickAt = { trial: 0, click: 0 };
    const score = (events: { hit: boolean; ms: number }[]) => {
      for (const e of events) { if (e.hit) { keeper.hit(e.ms); sounds.hit(keeper.state.streak - 1); } else { keeper.miss(); sounds.miss(); } }
    };
    const read = (r: Runner, now: number) => {
      if (r instanceof FlickRunner && r.log().spec.kind === 'warmup') return; // warm-up: no points
      if (r instanceof FlickRunner) {
        const trials = r.log().trials;
        const { events, next } = flickEvents(trials, flickAt);
        for (let i = flickAt.trial; i < next.trial; i++) if (trials[i]!.hitT !== null) scene.popAt(trials[i]!.target.aim);
        flickAt = next;
        score(events);
      } else if (r instanceof SwitchRunner) {
        const log = r.log();
        const { events, next } = switchEvents(log, cursor);
        cursor = next;
        for (; kills < log.kills.length; kills++) scene.popAt(log.kills[kills]!.target);
        score(events);
      } else if (r instanceof TrackSwitchRunner) {
        const log = r.log();
        const { events, next } = trackSwitchEvents(log, kills);
        for (; kills < next; kills++) scene.popAt(log.kills[kills]!.aim);
        score(events);
        if (r.state.damaging !== null && now - lastTick >= TICK_MS) { sounds.tick(); lastTick = now; }
      } else {
        const on = r.state.onTarget && now >= r.state.scoredFrom;
        keeper.track(now - lastFrame, on);
        if (on && now - lastTick >= TICK_MS) { sounds.tick(); lastTick = now; }
      }
    };
    const feedback = (r: Runner | null, now: number) => {
      if (r !== seen) {
        if (seen) read(seen, now);
        seen = r; cursor = 0; kills = 0; flickAt = { trial: 0, click: 0 };
        const kind = r?.log().spec.kind;
        if (kind && kind !== 'warmup') sounds.chime(kind);
      }
      if (r) read(r, now);
      const st = keeper.state;
      const text = `${st.points.toLocaleString()} pts${st.streak >= 2 ? ` · ×${st.streak} streak` : ''}`;
      if (text !== scoreText && scoreRef.current) { scoreRef.current.textContent = text; scoreText = text; }
    };

    const dispose = startCapture(
      document,
      (s) => { ctrl.onMove(s); sync(); },
      (t) => { ctrl.onClick(t); sync(); },
      () => { setLocked(false); ctrl.onLockLost(); sync(); },
      (t) => { ctrl.onRelease(t); },
    );

    if (last.phase === 'finished') cbRef.current.onFinished(ctrl.session, keeper.state);

    // End-of-part countdown: a beep at 5, 4, 3, 2 and 1 s left (sound only, so nothing covers the screen).
    let beepRunner: Runner | null = null, prevLeft = Infinity;
    const beep = (r: Runner | null, now: number) => {
      if (r !== beepRunner) { beepRunner = r; prevLeft = Infinity; }
      if (!r) return;
      const left = r.state.endsAt - now;
      if (countdownBeep(prevLeft, left) !== null) sounds.countdown(false);
      prevLeft = left;
    };

    let cueTick = -1;
    const drawCue = (now: number) => {
      const el = cueRef.current;
      const cue = ctrl.phase === 'cue' ? ctrl.cue : null;
      if (!el) return;
      if (!cue) { el.style.display = 'none'; cueTick = -1; return; }
      el.style.display = 'flex';
      const ticks = Math.round(cfg.round.cueMs / cfg.round.cueTickMs);
      const i = Math.min(ticks - 1, Math.max(0, Math.floor((now - cue.startedAt) / cfg.round.cueTickMs)));
      if (i !== cueTick) { cueTick = i; sounds.countdown(false); }
      if (cueTextRef.current) cueTextRef.current.textContent = cueText(cue.kind);
      if (cueNumRef.current) cueNumRef.current.textContent = String(ticks - i);
    };
    const drawTimer = (r: Runner | null, now: number) => {
      const box = timerRef.current;
      if (!box) return;
      if (!r) { box.style.display = 'none'; return; }
      box.style.display = 'flex';
      const lead = r instanceof TrackingRunner || r instanceof TrackSwitchRunner ? r.state.scoredFrom : null;
      const ready = lead !== null && now < lead;
      const left = r.state.endsAt - now;
      const span = r.state.endsAt - (lead ?? r.state.endsAt - partLength(r));
      if (timerNameRef.current) timerNameRef.current.textContent = partName(r);
      if (timerNumRef.current) timerNumRef.current.textContent = ready ? 'get ready' : clock(left);
      if (timerBarRef.current) {
        timerBarRef.current.style.width = `${ready ? 100 : Math.max(0, Math.min(100, (100 * left) / span))}%`;
        timerBarRef.current.classList.toggle('is-ending', !ready && left <= TIMER_ENDING_MS);
      }
    };
    const partLength = (r: Runner): number => (r instanceof FlickRunner
      ? (r.log().spec.kind === 'warmup' ? cfg.session.warmupMs : cfg.flick.blockMs) : cfg.switch.blockMs);

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
      if (holdRef.current) {
        const needsHold = (r instanceof TrackingRunner || r instanceof TrackSwitchRunner) && !r.state.held;
        holdRef.current.style.display = needsHold ? 'block' : 'none';
      }
      drawTimer(r, now);
      beep(r, now);
      drawCue(now);
      scene.setFlickTarget(r instanceof FlickRunner ? (r.state.target?.aim ?? null) : null);
      scene.setSwitchTargets(r instanceof SwitchRunner ? r.state.targets : []);
      scene.setTrackingTarget(r instanceof TrackingRunner ? r.state.targetAim : null, r instanceof TrackingRunner && r.state.onTarget);
      scene.setTrackSwitchTargets(r instanceof TrackSwitchRunner ? r.state.targets : [], r instanceof TrackSwitchRunner ? r.state.damaging : null);
      if (r) {
        scene.setAim(r.state.aim);
        const aim = r.state.aim;
        const target = r instanceof FlickRunner ? (r.state.target?.aim ?? null)
          : r instanceof TrackingRunner ? r.state.targetAim
          : r instanceof TrackSwitchRunner ? nearest(aim, r.state.targets.map((x) => x.aim))
          : nearest(aim, r.state.targets);
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
      sounds.close();
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
  const rounds = view.total / BLOCKS_PER_STEP;
  const round = Math.min(Math.floor(view.done / BLOCKS_PER_STEP) + 1, rounds);
  const quit = (
    <button type="button" class={quitArmed ? 'quit quit-armed' : 'quit'}
      onClick={(e) => { e.stopPropagation(); if (quitArmed) onQuit(); else setQuitArmed(true); }}>
      {quitArmed ? 'Click again to quit (progress is lost)' : 'Quit test'}
    </button>
  );

  return (
    <div class="run">
      <canvas ref={canvasRef} class="run-canvas" />
      {(view.phase === 'running' || view.phase === 'cue') && <div class="crosshair" aria-hidden="true" />}
      <div class="hud">{view.hud}</div>
      <div ref={timerRef} class="part-timer" aria-live="off" style={{ display: 'none' }}>
        <div ref={timerNameRef} class="part-timer-name" />
        <div ref={timerNumRef} class="part-timer-num" />
        <div class="part-timer-track"><div ref={timerBarRef} class="part-timer-bar" /></div>
      </div>
      <div ref={cueRef} class="cue" aria-live="assertive" style={{ display: 'none' }}>
        <p ref={cueTextRef} class="cue-text" />
        <p ref={cueNumRef} class="cue-num" />
      </div>
      <div ref={scoreRef} class="score-hud" aria-live="off" />
      {view.total > 0 && (
        <div class="progress" role="progressbar" aria-label="Session progress"
          aria-valuemin={0} aria-valuemax={view.total} aria-valuenow={view.done}>
          <div class="progress-fill" style={{ width: `${Math.max(1, Math.min(100, (100 * view.done) / view.total))}%` }} />
        </div>
      )}
      {view.total > 0 && view.hud !== 'Warm-up' && <div class="progress-count">Round {round} / ~{rounds}</div>}
      <div ref={arrowRef} class="offscreen-arrow" aria-hidden="true" />
      <div ref={holdRef} class="hold-prompt" aria-live="polite">Hold the mouse button</div>
      {countdown !== null && <Countdown text={view.restText} n={countdown} />}
      {view.phase === 'asking' && <AskCard reason={ctrl.session.extensionReason ?? 'close'} onAnswer={answer} />}
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
