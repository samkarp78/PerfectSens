import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import './styles.css';
import { defaultConfig } from '../core/config';
import type { SessionState } from '../core/session';
import {
  abandonTest, answerFeel, answerHourCheck, currentTarget, markBack, paFit, submitTest, testSession,
  type Feel, type PaState,
} from '../core/playalong/state';
import type { Prefs } from '../store/prefs';
import { holdProgress } from './hold';
import { rangeText } from './playAlongText';
import { Run } from './Run';

export interface PlayAlongProps {
  state: PaState;
  prefs: Prefs;
  /** Called after every change, so the search can be saved. */
  onChange(s: PaState): void;
  onFinished(s: PaState): void;
  /** Leave Play-Along; the search stays saved. */
  onQuit(): void;
  onUnsupported(): void;
}

const MINUTE_MS = 60_000;
const ELAPSED_REFRESH_MS = 15_000;
const FEELS: { feel: Feel; label: string }[] = [
  { feel: 'fast', label: 'Too fast' }, { feel: 'slow', label: 'Too slow' }, { feel: 'right', label: 'About right' },
];

/** A button that must be held for holdMs; releasing or leaving it early cancels. */
function HoldButton({ label, holdMs, onDone }: { label: string; holdMs: number; onDone(): void }) {
  const [fraction, setFraction] = useState(0);
  const downAt = useRef<number | null>(null);
  const frame = useRef(0);
  const stop = () => { downAt.current = null; cancelAnimationFrame(frame.current); setFraction(0); };
  const step = () => {
    const p = holdProgress(downAt.current, performance.now(), holdMs);
    setFraction(p.fraction);
    if (p.done) { stop(); onDone(); return; }
    if (downAt.current !== null) frame.current = requestAnimationFrame(step);
  };
  // Alt-tabbing away mid-press can swallow the release, so losing focus cancels the hold.
  useEffect(() => {
    const cancel = () => stop();
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', cancel);
    return () => {
      cancelAnimationFrame(frame.current);
      window.removeEventListener('blur', cancel);
      document.removeEventListener('visibilitychange', cancel);
    };
  }, []);
  return (
    <button type="button" class="btn btn-primary hold-btn"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        downAt.current = performance.now();
        frame.current = requestAnimationFrame(step);
      }}
      onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}>
      <span class="hold-fill" style={{ width: `${fraction * 100}%` }} aria-hidden="true" />
      <span class="hold-label">{label}</span>
    </button>
  );
}

function useNow(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ELAPSED_REFRESH_MS);
    return () => clearInterval(id);
  }, []);
  return now;
}

function Waiting({ s, onBack, onQuit }: { s: PaState; onBack(): void; onQuit(): void }) {
  const now = useNow();
  const t = currentTarget(s)!;
  const { game } = s.setup;
  const night = s.nights[s.nights.length - 1]!;
  const minutes = Math.max(0, Math.floor((now - night.startedAt) / MINUTE_MS));
  const last = s.tests[s.tests.length - 1];
  const justSaved = last !== undefined && last.finishedAt === s.waitingSince;
  return (
    <main class="page pa">
      {justSaved && <p class="pa-saved" role="status">Test saved.</p>}
      <p class="pa-label">{t.label}</p>
      {game === 'finals' ? (
        <h1 class="pa-number">Type <strong>{t.gameSens}</strong> into The Finals</h1>
      ) : (
        <h1 class="pa-number">Set your game to <strong>{t.cm360.toFixed(1)} cm/360</strong></h1>
      )}
      <p class="pa-sub">{t.cm360.toFixed(1)} cm/360
        {game === 'other' && <> · sliding the mouse {t.cm360.toFixed(1)} cm turns one full circle</>}</p>
      <div class="panel">
        <p>Play a match, then come back.</p>
        <p class="field-hint">After this: a 3-minute test. Tonight: {minutes} min so far.</p>
        <HoldButton label="Hold: I'm back" holdMs={defaultConfig.playAlong.holdMs} onDone={onBack} />
      </div>
      <button type="button" class="link" onClick={onQuit}>Save and quit</button>
    </main>
  );
}

function FeelCard({ onAnswer }: { onAnswer(f: Feel): void }) {
  return (
    <main class="page pa">
      <h1 class="title">How did that feel?</h1>
      <div class="actions pa-feel">
        {FEELS.map(({ feel, label }) => (
          <button key={feel} type="button" class="btn" onClick={() => onAnswer(feel)}>{label}</button>
        ))}
      </div>
    </main>
  );
}

function HourCheck({ s, onAnswer }: { s: PaState; onAnswer(c: 'continue' | 'later' | 'done'): void }) {
  const range = paFit(s)?.range ?? null;
  const { game, dpi } = s.setup;
  return (
    <main class="page pa">
      <h1 class="title">About an hour in</h1>
      <p class="pa-number">{game === 'finals' ? 'Your best The Finals sens: ' : 'Your best sens: '}<strong>{rangeText(range, game, dpi)}</strong></p>
      {range && game === 'finals' && <p class="pa-sub">{[...range].sort((a, b) => a - b).map((cm) => cm.toFixed(1)).join('–')} cm/360</p>}
      <p>Keep narrowing it down?</p>
      <div class="actions">
        <button type="button" class="btn btn-primary" onClick={() => onAnswer('continue')}>Keep going tonight</button>
        <button type="button" class="btn" onClick={() => onAnswer('later')}>Continue another night</button>
        <button type="button" class="btn" onClick={() => onAnswer('done')}>I'm done</button>
      </div>
    </main>
  );
}

export function PlayAlong({ state, prefs, onChange, onFinished, onQuit, onUnsupported }: PlayAlongProps) {
  const [s, setS] = useState(state);
  const submitted = useRef<SessionState | null>(null);
  const update = (n: PaState) => {
    setS(n);
    onChange(n);
    if (n.phase === 'finished') onFinished(n);
  };
  const session = useMemo(() => (s.phase === 'testing' ? testSession(s) : null), [s.phase, s.tests.length]);

  switch (s.phase) {
    case 'waiting':
      return <Waiting s={s} onBack={() => update(markBack(s, Date.now()))} onQuit={onQuit} />;
    case 'feel':
      return <FeelCard onAnswer={(f) => update(answerFeel(s, f))} />;
    case 'testing':
      return session ? (
        <Run key={`test-${s.tests.length}`} session={session} prefs={prefs} hideScores onUnsupported={onUnsupported}
          onQuit={() => update(abandonTest(s, Date.now()))}
          onFinished={(done) => {
            if (submitted.current === done) return;
            submitted.current = done;
            update(submitTest(s, done, Date.now()));
          }} />
      ) : null;
    case 'hourCheck':
      return <HourCheck s={s} onAnswer={(c) => {
        const n = answerHourCheck(s, c, Date.now());
        update(n);
        if (c === 'later') onQuit();
      }} />;
    default:
      return null;
  }
}
