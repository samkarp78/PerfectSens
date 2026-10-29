import { useEffect, useRef, useState } from 'preact/hooks';
import './styles.css';
import { defaultSimPlayer } from '../core/sim/player';
import { openHistory, recordFromPlayAlong, type History as HistoryStore, type SessionRecord, type SessionSummary } from '../store/history';
import { loadPrefs } from '../store/prefs';
import { Calibrate } from './Calibrate';
import { History } from './History';
import { Home } from './Home';
import { openPlayAlongStore, type PlayAlongStore } from '../store/playAlongStore';
import { createPlayAlong, isStale, paFit, resume, type PaSetup, type PaState } from '../core/playalong/state';
import { finalsToCm360 } from '../core/playalong/gameSens';
import { runPlayAlongSim } from '../core/sim/runPlayAlong';
import { PlayAlong } from './PlayAlong';
import { PlayAlongResults } from './PlayAlongResults';
import { PlayAlongSetup, type PaFields } from './PlayAlongSetup';
import { rangeText } from './playAlongText';

type Screen = 'home' | 'history' | 'calibrate' | 'paSetup' | 'playalong' | 'paResults';

const DEFAULT_DPI = 800;
const DEFAULT_FIELDS: PaFields = { game: 'finals', dpi: String(DEFAULT_DPI), sens: '', fov: '103', fovType: 'horizontal', padWidthCm: '' };

/** A saved search the player can continue: unfinished, or a best guess waiting for its head-to-head. */
const resumable = (s: PaState | null): s is PaState => s !== null && (s.phase !== 'finished' || s.result?.kind === 'bestGuess');

const SEED_MASK = 0x7fffffff;
const newSeed = (): number => Date.now() & SEED_MASK;

/** Dev only: ?paresult=1 shows a simulated Play-Along search's results (optimum at The Finals 30 for a player on 33). */
function paSimResult(): SessionRecord | null {
  if (!import.meta.env.DEV || new URLSearchParams(location.search).get('paresult') !== '1') return null;
  const setup: PaSetup = { game: 'finals', dpi: DEFAULT_DPI, defaultCm360: finalsToCm360(33, DEFAULT_DPI), padWidthCm: 45, fov: 103, fovType: 'horizontal' };
  const { state } = runPlayAlongSim(setup, defaultSimPlayer(setup.defaultCm360, { optimalCm360: finalsToCm360(30, DEFAULT_DPI) }), 3);
  return recordFromPlayAlong(state, new Date(), crypto.randomUUID());
}

export function App() {
  const [sim] = useState(paSimResult);
  const [screen, setScreen] = useState<Screen>(sim ? 'paResults' : 'home');
  const [done, setDone] = useState<SessionRecord | null>(sim);
  const [unsupported, setUnsupported] = useState(false);
  const [history, setHistory] = useState<HistoryStore | null>(null);
  const [historyReady, setHistoryReady] = useState(false);
  const historyRef = useRef<Promise<HistoryStore | null> | null>(null);
  const [prefs] = useState(loadPrefs);
  // Play-Along: the saved search (or null), its store and the setup form.
  const [pa, setPa] = useState<PaState | null>(null);
  const [paFields, setPaFields] = useState<PaFields>(DEFAULT_FIELDS);
  const paStoreRef = useRef<Promise<PlayAlongStore | null> | null>(null);
  // A quick try or a one-sitting test runs on its own unsaved state, so it leaves any real saved search alone.
  const [oneOff, setOneOff] = useState<PaState | null>(null);
  const [sittingSetup, setSittingSetup] = useState(false);

  useEffect(() => {
    historyRef.current = openHistory().catch(() => null);
    void historyRef.current.then((h) => { setHistory(h); setHistoryReady(true); });
    paStoreRef.current = openPlayAlongStore().catch(() => null);
    // A search saved by an older version can't be continued; it is set aside.
    void paStoreRef.current.then(async (st) => {
      const s = await st?.load();
      if (s?.version === 2) setPa(s); else if (s) await st?.clear();
    }).catch(() => undefined);
  }, []);

  const savePa = (s: PaState) => { setPa(s); void paStoreRef.current?.then((st) => st?.save(s)).catch(() => undefined); };
  const clearPa = () => { setPa(null); void paStoreRef.current?.then((st) => st?.clear()).catch(() => undefined); };
  const toHistory = (rec: SessionRecord) => { void historyRef.current?.then((h) => h?.save(rec)).catch(() => undefined); };
  const showResults = (rec: SessionRecord) => { setDone(rec); setScreen('paResults'); };

  const onPaFinished = (s: PaState) => {
    const rec = recordFromPlayAlong(s, new Date(), crypto.randomUUID());
    // A best guess stays saved so the next start can confirm it with a head-to-head.
    if (s.result?.kind === 'bestGuess') savePa(s); else clearPa();
    showResults(rec);
    toHistory(rec);
  };
  const onOneOffFinished = (s: PaState) => {
    setOneOff(null);
    // A one-sitting test is a real answer (History); a quick try never is.
    const rec = recordFromPlayAlong(s, new Date(), s.setup.sitting ? crypto.randomUUID() : 'quick-try');
    showResults(rec);
    if (s.setup.sitting) toHistory(rec);
  };

  const start = (setup: PaSetup) => { savePa(createPlayAlong(setup, newSeed(), Date.now())); setScreen('playalong'); };
  const startOneOff = (setup: PaSetup) => { setOneOff(createPlayAlong(setup, newSeed(), Date.now())); setScreen('playalong'); };
  const onContinue = () => {
    if (!pa) return;
    const s = resume(pa, Date.now());
    savePa(s);
    if (s.phase === 'finished') onPaFinished(s); else setScreen('playalong');
  };
  const onOpen = (s: SessionSummary) => {
    void history?.get(s.id).then((rec) => { if (rec?.playAlong) showResults(rec); });
  };
  const onUnsupported = () => { setUnsupported(true); setScreen('home'); };

  switch (screen) {
    case 'paSetup': {
      const saved = resumable(pa) ? pa : null;
      return <PlayAlongSetup fields={paFields} onFields={setPaFields} sitting={sittingSetup}
        saved={saved ? { rangeText: rangeText(paFit(saved)?.range ?? null, saved.setup.game, saved.setup.dpi), stale: isStale(saved, Date.now()) } : null}
        onCalibrate={(f) => { setPaFields(f); setScreen('calibrate'); }}
        onStart={(setup) => (sittingSetup ? startOneOff({ ...setup, sitting: true }) : start(setup))}
        onQuickTry={(setup) => startOneOff({ ...setup, quick: true })}
        onQuickTrySaved={() => { if (pa) startOneOff({ ...pa.setup, quick: true }); }}
        onContinue={onContinue} onStartFresh={clearPa} onBack={() => setScreen('home')} />;
    }
    case 'playalong':
      if (oneOff) {
        return <PlayAlong key={oneOff.seed} state={oneOff} prefs={prefs} onChange={setOneOff} onFinished={onOneOffFinished}
          onQuit={() => { setOneOff(null); setScreen('home'); }} onUnsupported={onUnsupported} />;
      }
      return pa ? <PlayAlong key={pa.seed} state={pa} prefs={prefs} onChange={savePa} onFinished={onPaFinished}
        onQuit={() => setScreen('home')} onUnsupported={onUnsupported} /> : null;
    case 'paResults':
      return done ? <PlayAlongResults rec={done} onAgain={() => setScreen('home')} onHistory={() => setScreen('history')} /> : null;
    case 'history':
      return <History history={history} loading={!historyReady} onBack={() => setScreen(done ? 'paResults' : 'home')} onOpen={onOpen} />;
    case 'calibrate':
      return <Calibrate dpi={Number(paFields.dpi) || DEFAULT_DPI} onUnsupported={onUnsupported}
        onDone={(cm) => { setPaFields({ ...paFields, padWidthCm: String(cm) }); setScreen('paSetup'); }}
        onCancel={() => setScreen('paSetup')} />;
    default:
      return <Home unsupported={unsupported} playAlongSaved={resumable(pa)}
        onPlayAlong={() => { setSittingSetup(false); setScreen('paSetup'); }}
        onStandard={() => { setSittingSetup(true); setScreen('paSetup'); }} onHistory={() => setScreen('history')} />;
  }
}
