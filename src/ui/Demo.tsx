import { useEffect, useRef, useState } from 'preact/hooks';
import './styles.css';
import { trackingTargetAt } from '../core/blocks';
import { defaultConfig } from '../core/config';
import { angleBetween } from '../core/geometry';
import { defaultSimPlayer } from '../core/sim/player';
import { runSimSession } from '../core/sim/runSession';
import type { Aim, AimSample, FlickBlockLog, Setup as SetupValues } from '../core/types';
import { createScene } from '../scene/scene';
import { recordFromSession } from '../store/history';
import { buildDemoScript, type DemoClip } from './demoScript';
import { Results } from './Results';

const DEMO_SETUP: SetupValues = { dpi: 800, cm360: 34.29, inGameSens: null, fov: 103, fovType: 'horizontal', mode: 'default' };
const ORIGIN: Aim = { yaw: 0, pitch: 0 };

export interface DemoProps { onExit(): void; onHistory(): void }

/** Today's date as a YYYYMMDD integer, so the demo is stable within a day. */
const dateSeed = (d: Date): number => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();

/** Last path sample at or before t (binary search); the origin before the first sample. */
export function aimAt(path: AimSample[], t: number): Aim {
  let lo = 0, hi = path.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (path[mid]!.t <= t) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  const s = found >= 0 ? path[found]! : path[0];
  return s ? { yaw: s.yaw, pitch: s.pitch } : ORIGIN;
}

function flickTargetAt(log: FlickBlockLog, t: number): Aim | null {
  for (let i = 0; i < log.trials.length; i++) {
    const tr = log.trials[i]!;
    const end = tr.hitT ?? log.trials[i + 1]?.spawnT ?? Infinity;
    if (tr.spawnT <= t && end > t) return tr.target.aim;
  }
  return null;
}

function Player({ clips, onDone }: { clips: DemoClip[]; onDone(): void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [idx, setIdx] = useState(0);
  const idxRef = useRef(0);
  const startRef = useRef(0);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const next = () => {
    if (idxRef.current >= clips.length - 1) { doneRef.current(); return; }
    idxRef.current += 1;
    startRef.current = performance.now();
    setIdx(idxRef.current);
  };
  const nextRef = useRef(next);
  nextRef.current = next;

  useEffect(() => {
    const canvas = canvasRef.current!;
    const scene = createScene(canvas, { fov: DEMO_SETUP.fov, fovType: DEMO_SETUP.fovType, targetRadiusDeg: defaultConfig.flick.targetRadiusDeg });
    const fit = () => scene.resize(canvas.clientWidth, canvas.clientHeight);
    fit();
    window.addEventListener('resize', fit);
    startRef.current = performance.now();
    let raf = 0;
    let disposed = false;
    const frame = () => {
      if (disposed) return;
      const clip = clips[idxRef.current]!;
      const t = clip.fromT + ((performance.now() - startRef.current) * clip.speed);
      if (t >= clip.toT) {
        nextRef.current();
        if (disposed) return;
      } else {
        const aim = aimAt(clip.log.path, t);
        scene.setAim(aim);
        if ('trials' in clip.log) {
          scene.setFlickTarget(flickTargetAt(clip.log, t));
          scene.setTrackingTarget(null, false);
        } else {
          const target = trackingTargetAt(clip.spec, t - clip.log.t0, defaultConfig);
          scene.setFlickTarget(null);
          scene.setTrackingTarget(target, angleBetween(aim, target) <= defaultConfig.tracking.targetRadiusDeg);
        }
        scene.render();
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', fit);
      scene.dispose();
    };
  }, []);

  return (
    <div class="run demo" onClick={() => nextRef.current()}>
      <canvas ref={canvasRef} class="run-canvas" />
      <div class="crosshair" aria-hidden="true" />
      <div class="hud">Demo {idx + 1}/{clips.length}</div>
      <button type="button" class="demo-skip" onClick={(e) => { e.stopPropagation(); doneRef.current(); }}>Skip to results</button>
      <div class="demo-caption" role="status" aria-live="polite">
        <p>{clips[idx]!.caption}</p>
        <span class="demo-hint">Tap to skip ahead</span>
      </div>
    </div>
  );
}

export function Demo({ onExit, onHistory }: DemoProps) {
  const [data] = useState(() => {
    const run = runSimSession(DEMO_SETUP, defaultSimPlayer(DEMO_SETUP.cm360, { optimalCm360: DEMO_SETUP.cm360 * defaultConfig.demo.player.optimalRatio }), { seed: dateSeed(new Date()), warmup: false, quickAbCm360: null });
    return { run, clips: buildDemoScript(run), rec: recordFromSession(run.state, new Date(), 'demo') };
  });
  const [finished, setFinished] = useState(false);
  if (!finished) return <Player clips={data.clips} onDone={() => setFinished(true)} />;
  return (
    <>
      <h1 class="demo-banner">Demo results (simulated player)</h1>
      <Results rec={data.rec} fit={data.run.state.fit} onAgain={onExit} onHistory={onHistory} />
    </>
  );
}
