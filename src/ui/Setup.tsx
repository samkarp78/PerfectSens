import { useState } from 'preact/hooks';
import { defaultConfig } from '../core/config';
import { validateSetup } from '../core/setup';
import type { Prefs } from '../store/prefs';
import type { Setup as SetupValues } from '../core/types';
import { loadSetup } from '../store/setupStore';
import { dpiEdit, dpiValid } from './setupFields';

export const DEFAULT_SETUP: SetupValues = { dpi: 800, cm360: 34.6364, inGameSens: 33, fov: 103, fovType: 'horizontal', mode: 'default' };
export const UNSUPPORTED_TEXT = "Raw mouse input isn't supported in this browser. Use Chrome or Edge on desktop. The demo still works here.";

export interface SetupProps {
  unsupported: boolean;
  prefs: Prefs;
  /** Form values to restore (after returning from calibration). */
  draft?: Fields | null;
  onPrefs(p: Prefs): void;
  onCalibrate(fields: Fields): void;
  onStart(setup: SetupValues, warmup: boolean): void;
  onDemo(): void;
  onHistory(): void;
}

export type Fields = { dpi: string; cm360: string; inGameSens: string; fov: string; fovType: string; mode: string; padWidthCm: string };

function initialFields(): Fields {
  const s = { ...DEFAULT_SETUP, ...loadSetup() };
  return {
    dpi: String(s.dpi), cm360: String(s.cm360), inGameSens: s.inGameSens === null || s.inGameSens === undefined ? '' : String(s.inGameSens),
    fov: String(s.fov), fovType: String(s.fovType), mode: String(s.mode),
    padWidthCm: s.padWidthCm === null || s.padWidthCm === undefined ? '' : String(s.padWidthCm),
  };
}

/** A note when the current sens already needs more room for a 180° turn than the measured play area gives. */
function fitWarning(f: Fields): string | null {
  const cm360 = Number(f.cm360), pad = Number(f.padWidthCm);
  if (!f.padWidthCm || !(cm360 > 0) || !(pad > 0)) return null;
  const half = cm360 / 2;
  if (half <= pad * defaultConfig.pad.turnFraction) return null;
  return `A 180° turn at your sens needs ${half.toFixed(1)} cm, more than your ${pad} cm play area comfortably allows.`;
}

export function Setup({ unsupported, prefs, draft, onPrefs, onCalibrate, onStart, onDemo, onHistory }: SetupProps) {
  const [f, setF] = useState<Fields>(() => draft ?? initialFields());
  const [warmup, setWarmup] = useState(true);
  const [errors, setErrors] = useState<Partial<Record<keyof Fields, string>>>({});
  const [dpiNote, setDpiNote] = useState<string | null>(null);
  const set = (k: keyof Fields) => (e: Event) => {
    const v = (e.target as HTMLInputElement).value;
    if (k !== 'dpi') { setF({ ...f, [k]: v }); return; }
    const r = dpiEdit(f, v);
    setF(r.fields);
    if (r.note) setDpiNote(r.note);
  };

  const submit = (e: Event) => {
    e.preventDefault();
    const r = validateSetup(f);
    if (!r.ok) { setErrors(r.errors); return; }
    setErrors({});
    onStart(r.setup, warmup);
  };

  const field = (k: keyof Fields, label: string, hint: string) => (
    <label class="field">
      <span class="field-label">{label}</span>
      <input class="input" type="text" inputMode="decimal" name={k} value={f[k]} onInput={set(k)}
        aria-invalid={errors[k] ? 'true' : undefined} />
      <span class="field-hint">{hint}</span>
      {errors[k] && <span class="field-error" role="alert">{errors[k]}</span>}
    </label>
  );

  return (
    <main class="page">
      <h1 class="title">Blind Sens Finder</h1>
      <p class="lede">Find the mouse sensitivity that works best for you, tested blind. You won't see which sens is being tested until the end.</p>
      {unsupported && (
        <div class="notice" role="alert">
          <p>{UNSUPPORTED_TEXT}</p>
        </div>
      )}
      <form class="panel" onSubmit={submit} noValidate>
        {field('dpi', 'Mouse DPI', 'Whole number, from your mouse software.')}
        {field('cm360', 'Current cm/360', 'Distance your mouse travels for a full turn.')}
        {field('inGameSens', 'Current in-game sens (optional)', 'If given, the results show your new in-game number.')}
        <div class="row">
          {field('fov', 'FOV', 'Your in-game field of view.')}
          <label class="field">
            <span class="field-label">FOV type</span>
            <select class="input" value={f.fovType} onChange={set('fovType')}>
              <option value="horizontal">Horizontal</option>
              <option value="vertical">Vertical</option>
            </select>
            {errors.fovType && <span class="field-error" role="alert">{errors.fovType}</span>}
          </label>
        </div>
        <div class="field">
          <span class="field-label">Play area (optional)</span>
          <div class="row row-tight">
            <input class="input" type="text" inputMode="decimal" name="padWidthCm" value={f.padWidthCm} onInput={set('padWidthCm')}
              placeholder="cm" aria-invalid={errors.padWidthCm ? 'true' : undefined} />
            <button type="button" class="btn" disabled={!dpiValid(f.dpi)} title={dpiValid(f.dpi) ? undefined : 'Enter your DPI first'}
              onClick={() => { setDpiNote(null); onCalibrate(f); }}>Calibrate</button>
          </div>
          <span class="field-hint">How far your mouse can travel on your pad. Calibrate measures it with a couple of slides.</span>
          {errors.padWidthCm && <span class="field-error" role="alert">{errors.padWidthCm}</span>}
          {dpiNote && !f.padWidthCm && <span class="field-warn">{dpiNote}</span>}
          {fitWarning(f) && <span class="field-warn">{fitWarning(f)}</span>}
        </div>
        <fieldset class="field fieldset">
          <legend class="field-label">Mode</legend>
          <label class="radio"><input type="radio" name="mode" value="default" checked={f.mode === 'default'} onChange={set('mode')} /> Default (about 12 min)</label>
          <label class="radio"><input type="radio" name="mode" value="thorough" checked={f.mode === 'thorough'} onChange={set('mode')} /> Thorough (about 16 min)</label>
          <label class="radio"><input type="radio" name="mode" value="quick" checked={f.mode === 'quick'} onChange={set('mode')} /> Quick test (about 6 min, for trying it out; not a reliable answer)</label>
          {errors.mode && <span class="field-error" role="alert">{errors.mode}</span>}
        </fieldset>
        <label class="radio"><input type="checkbox" checked={warmup} onChange={(e) => setWarmup((e.target as HTMLInputElement).checked)} /> Warm up first (recommended, 1 min)</label>
        <label class="radio"><input type="checkbox" checked={prefs.autoContinue} onChange={(e) => onPrefs({ ...prefs, autoContinue: (e.target as HTMLInputElement).checked })} /> Start rounds automatically (3-2-1 countdown)</label>
        <label class="radio"><input type="checkbox" checked={prefs.sound} onChange={(e) => onPrefs({ ...prefs, sound: (e.target as HTMLInputElement).checked })} /> Sound effects</label>
        <div class="actions">
          <button type="submit" class="btn btn-primary">Start</button>
          <button type="button" class="btn" onClick={onHistory}>History</button>
          {unsupported && <button type="button" class="btn" onClick={onDemo}>Try the demo</button>}
        </div>
      </form>
      {!unsupported && <button type="button" class="link" onClick={onDemo}>Try the demo</button>}
    </main>
  );
}
