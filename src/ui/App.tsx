import { useEffect, useRef, useState } from 'preact/hooks';
import { configForMode } from '../core/config';
import './styles.css';
import { createSession, fitFromSteps, type SessionState } from '../core/session';
import type { FitResult } from '../core/fit';
import type { Setup as SetupValues } from '../core/types';
import { defaultSimPlayer } from '../core/sim/player';
import { runSimSession } from '../core/sim/runSession';
import { openHistory, recordFromPlayAlong, recordFromSession, type History as HistoryStore, type SessionRecord, type SessionSummary } from '../store/history';
import { saveSetup } from '../store/setupStore';
import { loadPrefs, savePrefs, type Prefs } from '../store/prefs';
import type { ScoreState } from './scoreKeeper';
import { Calibrate } from './Calibrate';
import { Demo } from './Demo';
import { History } from './History';
import { Results } from './Results';
import { Run } from './Run';
import { DEFAULT_SETUP, Setup, type Fields } from './Setup';
import { recordBests, type Bests } from '../store/bests';
import { loadSetup } from '../store/setupStore';
import { openPlayAlongStore, type PlayAlongStore } from '../store/playAlongStore';
import { createPlayAlong, isStale, paFit, resume, type PaSetup, type PaState } from '../core/playalong/state';
import { finalsToCm360, gameSensOf } from '../core/playalong/gameSens';
import { runPlayAlongSim } from '../core/sim/runPlayAlong';
import { PlayAlong } from './PlayAlong';
import { PlayAlongResults } from './PlayAlongResults';
import { PlayAlongSetup, type PaFields } from './PlayAlongSetup';
import { rangeText } from './playAlongText';

type Screen = 'setup' | 'run' | 'results' | 'history' | 'demo' | 'calibrate' | 'paSetup' | 'playalong' | 'paResults';

/** A saved search the player can continue: unfinished, or a best guess waiting for its head-to-head. */
const resumable = (s: PaState | null): s is PaState => s !== null && (s.phase !== 'finished' || s.result?.kind === 'bestGuess');

/** Play-Along setup fields, pre-filled from the saved Standard setup. */
function initialPaFields(): PaFields {
  const s = loadSetup();
  const dpi = s?.dpi ?? DEFAULT_SETUP.dpi;
  const sens = s?.cm360 ? gameSensOf('finals', s.cm360, dpi) : null;
  return { game: 'finals', dpi: String(dpi), sens: sens ? String(sens) : '', fov: String(s?.fov ?? DEFAULT_SETUP.fov),
    fovType: s?.fovType ?? DEFAULT_SETUP.fovType, padWidthCm: s?.padWidthCm ? String(s.padWidthCm) : '' };
}
/** bests: personal bests merged once when the session finished, so a remount of Results keeps its "new best!" flags. */
interface Done { rec: SessionRecord; fit: FitResult | null; stats: ScoreState | null; bests: Bests | null }

const SEED_MASK = 0x7fffffff;
const newSeed = (): number => Date.now() & SEED_MASK;

function simResult(): Done | null {
  if (!import.meta.env.DEV || new URLSearchParams(location.search).get('simresult') !== '1') return null;
  const { state } = runSimSession(DEFAULT_SETUP, defaultSimPlayer(DEFAULT_SETUP.cm360), { seed: 1, warmup: false, quickAbCm360: null });
  return { rec: recordFromSession(state, new Date(), crypto.randomUUID()), fit: state.fit, stats: null, bests: null };
}

/** Dev only: ?paresult=1 shows a simulated Play-Along search's results (optimum at The Finals 30 for a player on 33). */
function paSimResult(): Done | null {
  if (!import.meta.env.DEV || new URLSearchParams(location.search).get('paresult') !== '1') return null;
  const dpi = DEFAULT_SETUP.dpi;
  const setup: PaSetup = { game: 'finals', dpi, defaultCm360: finalsToCm360(33, dpi), padWidthCm: 45, fov: 103, fovType: 'horizontal' };
  const { state } = runPlayAlongSim(setup, defaultSimPlayer(setup.defaultCm360, { optimalCm360: finalsToCm360(30, dpi) }), 3);
  return { rec: recordFromPlayAlong(state, new Date(), crypto.randomUUID()), fit: null, stats: null, bests: null };
}

export function App() {
  const [sim] = useState(() => simResult() ?? paSimResult());
  const [screen, setScreen] = useState<Screen>(sim ? (sim.rec.mode === 'playalong' ? 'paResults' : 'results') : 'setup');
  const [session, setSession] = useState<SessionState | null>(null);
  const [done, setDone] = useState<Done | null>(sim);
  const [unsupported, setUnsupported] = useState(false);
  const [history, setHistory] = useState<HistoryStore | null>(null);
  const [historyReady, setHistoryReady] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const historyRef = useRef<Promise<HistoryStore | null> | null>(null);
  const handled = useRef<SessionState | null>(null);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [draft, setDraft] = useState<Fields | null>(null);
  const onPrefs = (p: Prefs) => { setPrefs(p); savePrefs(p); };
  // Play-Along: the saved search (or null), its store, the setup form and where Calibrate returns to.
  const [pa, setPa] = useState<PaState | null>(null);
  const [paFields, setPaFields] = useState<PaFields>(initialPaFields);
  const [calibrateFor, setCalibrateFor] = useState<'setup' | 'paSetup'>('setup');
  const paStoreRef = useRef<Promise<PlayAlongStore | null> | null>(null);

  useEffect(() => {
    paStoreRef.current = openPlayAlongStore().catch(() => null);
    void paStoreRef.current.then((st) => st?.load()).then((s) => { if (s) setPa(s); }).catch(() => undefined);
  }, []);

  const savePa = (s: PaState) => { setPa(s); void paStoreRef.current?.then((st) => st?.save(s)).catch(() => undefined); };
  const clearPa = () => { setPa(null); void paStoreRef.current?.then((st) => st?.clear()).catch(() => undefined); };

  const onPaFinished = (s: PaState) => {
    const rec = recordFromPlayAlong(s, new Date(), crypto.randomUUID());
    // A best guess stays saved so the next start can confirm it with a head-to-head.
    if (s.result?.kind === 'bestGuess') savePa(s); else clearPa();
    setSaveFailed(false);
    setDone({ rec, fit: null, stats: null, bests: null });
    setScreen('paResults');
    void historyRef.current?.then((h) => h?.save(rec)).catch(() => setSaveFailed(true));
  };

  const onPaStart = (setup: PaSetup) => { savePa(createPlayAlong(setup, newSeed(), Date.now())); setScreen('playalong'); };
  const onPaContinue = () => {
    if (!pa) return;
    const s = resume(pa, Date.now());
    savePa(s);
    if (s.phase === 'finished') onPaFinished(s); else setScreen('playalong');
  };

  useEffect(() => {
    historyRef.current = openHistory().catch(() => null);
    void historyRef.current.then((h) => {
      setHistory(h);
      setHistoryReady(true);
      if (sim && h) void h.save(sim.rec).catch(() => undefined);
    });
  }, []);

  const begin = (setup: SetupValues, warmup: boolean, quickAbCm360: number | null) => {
    setSession(createSession(setup, { seed: newSeed(), warmup, quickAbCm360, askBeforeExtending: true }, configForMode(setup.mode)));
    setUnsupported(false);
    setScreen('run');
  };

  const onStart = (setup: SetupValues, warmup: boolean) => {
    saveSetup(setup);
    setDraft(null); // the saved setup is the source of truth from here on
    begin(setup, warmup, null);
  };

  const onQuickAb = (s: SessionSummary) => {
    setDraft(null);
    const setup: SetupValues = { ...s.setup, cm360: s.result.recommendedCm360, inGameSens: s.result.newInGameSens };
    begin(setup, false, s.result.currentCm360);
  };

  const onFinished = (state: SessionState, stats: ScoreState) => {
    if (handled.current === state || !state.result) return;
    handled.current = state;
    const rec = recordFromSession(state, new Date(), crypto.randomUUID());
    setSaveFailed(false);
    setDone({ rec, fit: state.fit, stats, bests: recordBests(stats) });
    setScreen('results');
    void historyRef.current?.then((h) => h?.save(rec)).catch(() => { if (handled.current === state) setSaveFailed(true); });
  };

  const onOpen = (s: SessionSummary) => {
    void history?.get(s.id).then((rec) => {
      if (!rec) return;
      setSaveFailed(false);
      setDone({ rec, fit: rec.mode === 'full' ? fitFromSteps(rec.setup, rec.steps) : null, stats: null, bests: null });
      setScreen(rec.mode === 'playalong' ? 'paResults' : 'results');
    });
  };

  const onUnsupported = () => { setUnsupported(true); setScreen('setup'); };

  switch (screen) {
    case 'run':
      return session ? <Run key={session._seed} session={session} prefs={prefs} onFinished={onFinished} onUnsupported={onUnsupported} onQuit={() => setScreen('setup')} /> : null;
    case 'paSetup': {
      const saved = resumable(pa) ? pa : null;
      return <PlayAlongSetup fields={paFields} onFields={setPaFields}
        saved={saved ? { rangeText: rangeText(paFit(saved)?.range ?? null, saved.setup.game, saved.setup.dpi), stale: isStale(saved, Date.now()) } : null}
        onCalibrate={(f) => { setPaFields(f); setCalibrateFor('paSetup'); setScreen('calibrate'); }}
        onStart={onPaStart} onContinue={onPaContinue} onStartFresh={clearPa} onBack={() => setScreen('setup')} />;
    }
    case 'playalong':
      return pa ? <PlayAlong key={pa.seed} state={pa} prefs={prefs} onChange={savePa} onFinished={onPaFinished}
        onQuit={() => setScreen('setup')} onUnsupported={onUnsupported} /> : null;
    case 'paResults':
      return done ? <PlayAlongResults rec={done.rec} onAgain={() => setScreen('setup')} onHistory={() => setScreen('history')} /> : null;
    case 'results':
      return done ? <Results rec={done.rec} fit={done.fit} stats={done.stats} bests={done.bests} saveFailed={saveFailed} onAgain={() => setScreen('setup')} onHistory={() => setScreen('history')} /> : null;
    case 'history':
      return <History history={history} loading={!historyReady} onBack={() => setScreen(done ? 'results' : 'setup')} onQuickAb={onQuickAb} onOpen={onOpen} />;
    case 'demo':
      return <Demo onExit={() => setScreen('setup')} onHistory={() => setScreen('history')} />;
    case 'calibrate':
      if (calibrateFor === 'paSetup') {
        return <Calibrate dpi={Number(paFields.dpi) || DEFAULT_SETUP.dpi} onUnsupported={onUnsupported}
          onDone={(cm) => { setPaFields({ ...paFields, padWidthCm: String(cm) }); setScreen('paSetup'); }}
          onCancel={() => setScreen('paSetup')} />;
      }
      return draft ? (
        <Calibrate dpi={Number(draft.dpi) || DEFAULT_SETUP.dpi} onUnsupported={onUnsupported}
          onDone={(cm) => { setDraft({ ...draft, padWidthCm: String(cm) }); setScreen('setup'); }}
          onCancel={() => setScreen('setup')} />
      ) : null;
    default:
      return <Setup unsupported={unsupported} prefs={prefs} draft={draft} onPrefs={onPrefs}
        onCalibrate={(fields) => { setDraft(fields); setCalibrateFor('setup'); setScreen('calibrate'); }} onStart={onStart} onDemo={() => setScreen('demo')} onHistory={() => setScreen('history')}
        onPlayAlong={() => setScreen('paSetup')} playAlongSaved={resumable(pa)} />;
  }
}
