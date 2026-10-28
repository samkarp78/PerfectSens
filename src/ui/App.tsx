import { useEffect, useRef, useState } from 'preact/hooks';
import { configForMode } from '../core/config';
import './styles.css';
import { createSession, type SessionState } from '../core/session';
import type { FitResult } from '../core/fit';
import type { Setup as SetupValues } from '../core/types';
import { defaultSimPlayer } from '../core/sim/player';
import { runSimSession } from '../core/sim/runSession';
import { openHistory, recordFromSession, type History as HistoryStore, type SessionRecord, type SessionSummary } from '../store/history';
import { saveSetup } from '../store/setupStore';
import { Demo } from './Demo';
import { History } from './History';
import { Results } from './Results';
import { Run } from './Run';
import { DEFAULT_SETUP, Setup } from './Setup';

type Screen = 'setup' | 'run' | 'results' | 'history' | 'demo';
interface Done { rec: SessionRecord; fit: FitResult | null }

const SEED_MASK = 0x7fffffff;
const newSeed = (): number => Date.now() & SEED_MASK;

function simResult(): Done | null {
  if (!import.meta.env.DEV || new URLSearchParams(location.search).get('simresult') !== '1') return null;
  const { state } = runSimSession(DEFAULT_SETUP, defaultSimPlayer(DEFAULT_SETUP.cm360), { seed: 1, warmup: false, quickAbCm360: null });
  return { rec: recordFromSession(state, new Date(), crypto.randomUUID()), fit: state.fit };
}

export function App() {
  const [sim] = useState(simResult);
  const [screen, setScreen] = useState<Screen>(sim ? 'results' : 'setup');
  const [session, setSession] = useState<SessionState | null>(null);
  const [done, setDone] = useState<Done | null>(sim);
  const [unsupported, setUnsupported] = useState(false);
  const [history, setHistory] = useState<HistoryStore | null>(null);
  const [historyReady, setHistoryReady] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const historyRef = useRef<Promise<HistoryStore | null> | null>(null);
  const handled = useRef<SessionState | null>(null);

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
    begin(setup, warmup, null);
  };

  const onQuickAb = (s: SessionSummary) => {
    const setup: SetupValues = { ...s.setup, cm360: s.result.recommendedCm360, inGameSens: s.result.newInGameSens };
    begin(setup, false, s.result.currentCm360);
  };

  const onFinished = (state: SessionState) => {
    if (handled.current === state || !state.result) return;
    handled.current = state;
    const rec = recordFromSession(state, new Date(), crypto.randomUUID());
    setSaveFailed(false);
    setDone({ rec, fit: state.fit });
    setScreen('results');
    void historyRef.current?.then((h) => h?.save(rec)).catch(() => { if (handled.current === state) setSaveFailed(true); });
  };

  const onUnsupported = () => { setUnsupported(true); setScreen('setup'); };

  switch (screen) {
    case 'run':
      return session ? <Run key={session._seed} session={session} onFinished={onFinished} onUnsupported={onUnsupported} onQuit={() => setScreen('setup')} /> : null;
    case 'results':
      return done ? <Results rec={done.rec} fit={done.fit} saveFailed={saveFailed} onAgain={() => setScreen('setup')} onHistory={() => setScreen('history')} /> : null;
    case 'history':
      return <History history={history} loading={!historyReady} onBack={() => setScreen(done ? 'results' : 'setup')} onQuickAb={onQuickAb} />;
    case 'demo':
      return <Demo onExit={() => setScreen('setup')} onHistory={() => setScreen('history')} />;
    default:
      return <Setup unsupported={unsupported} onStart={onStart} onDemo={() => setScreen('demo')} onHistory={() => setScreen('history')} />;
  }
}
