import { useState } from 'preact/hooks';
import { validateSetup } from '../core/setup';
import type { Setup as SetupValues } from '../core/types';
import { loadSetup } from '../store/setupStore';

export const DEFAULT_SETUP: SetupValues = { dpi: 800, cm360: 34.6364, inGameSens: 33, fov: 103, fovType: 'horizontal', mode: 'default' };
export const UNSUPPORTED_TEXT = "Raw mouse input isn't supported in this browser. Use Chrome or Edge on desktop. The demo still works here.";

export interface SetupProps {
  unsupported: boolean;
  onStart(setup: SetupValues, warmup: boolean): void;
  onDemo(): void;
  onHistory(): void;
}

type Fields = { dpi: string; cm360: string; inGameSens: string; fov: string; fovType: string; mode: string };

function initialFields(): Fields {
  const s = { ...DEFAULT_SETUP, ...loadSetup() };
  return {
    dpi: String(s.dpi), cm360: String(s.cm360), inGameSens: s.inGameSens === null || s.inGameSens === undefined ? '' : String(s.inGameSens),
    fov: String(s.fov), fovType: String(s.fovType), mode: String(s.mode),
  };
}

export function Setup({ unsupported, onStart, onDemo, onHistory }: SetupProps) {
  const [f, setF] = useState<Fields>(initialFields);
  const [warmup, setWarmup] = useState(true);
  const [errors, setErrors] = useState<Partial<Record<keyof Fields, string>>>({});
  const set = (k: keyof Fields) => (e: Event) => setF({ ...f, [k]: (e.target as HTMLInputElement).value });

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
        <fieldset class="field fieldset">
          <legend class="field-label">Mode</legend>
          <label class="radio"><input type="radio" name="mode" value="default" checked={f.mode === 'default'} onChange={set('mode')} /> Default (about 15 min)</label>
          <label class="radio"><input type="radio" name="mode" value="thorough" checked={f.mode === 'thorough'} onChange={set('mode')} /> Thorough (about 20 min)</label>
          <label class="radio"><input type="radio" name="mode" value="quick" checked={f.mode === 'quick'} onChange={set('mode')} /> Quick test (about 5 min, for trying it out; not a reliable answer)</label>
          {errors.mode && <span class="field-error" role="alert">{errors.mode}</span>}
        </fieldset>
        <label class="radio"><input type="checkbox" checked={warmup} onChange={(e) => setWarmup((e.target as HTMLInputElement).checked)} /> Warm up first (recommended, 1 min)</label>
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
