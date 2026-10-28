import { useState } from 'preact/hooks';
import './styles.css';
import { validatePaSetup } from '../core/playalong/setup';
import type { PaSetup } from '../core/playalong/state';

export type PaFields = { game: string; dpi: string; sens: string; fov: string; fovType: string; padWidthCm: string };

/** A saved search to continue: its range text, and whether it has gone stale. */
export interface SavedSearch { rangeText: string; stale: boolean }

export interface PlayAlongSetupProps {
  fields: PaFields;
  saved: SavedSearch | null;
  onFields(f: PaFields): void;
  onCalibrate(f: PaFields): void;
  onStart(setup: PaSetup): void;
  onContinue(): void;
  onStartFresh(): void;
  onBack(): void;
}

export function PlayAlongSetup({ fields: f, saved, onFields, onCalibrate, onStart, onContinue, onStartFresh, onBack }: PlayAlongSetupProps) {
  const [errors, setErrors] = useState<Partial<Record<keyof PaFields, string>>>({});
  const set = (k: keyof PaFields) => (e: Event) => onFields({ ...f, [k]: (e.target as HTMLInputElement).value });
  const finals = f.game === 'finals';

  const submit = (e: Event) => {
    e.preventDefault();
    const r = validatePaSetup(f);
    if (!r.ok) { setErrors(r.errors); return; }
    setErrors({});
    onStart(r.setup);
  };

  const field = (k: keyof PaFields, label: string, hint: string) => (
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
      <h1 class="title">Play-Along mode</h1>
      <p class="lede">Play a match on a sens, come back for a 3-minute test, repeat. The app narrows in on your best sens over about an hour, and you can continue on another night.</p>
      {saved && (
        <div class="panel">
          <p>You have a search in progress: <strong>{saved.rangeText}</strong>.</p>
          {saved.stale && <p class="field-warn">It's been over two weeks since your last test. Your aim may have changed since then.</p>}
          <div class="actions">
            <button type="button" class="btn btn-primary" onClick={onContinue}>Continue your search</button>
            <button type="button" class="btn" onClick={onStartFresh}>Start fresh</button>
          </div>
        </div>
      )}
      {!saved && (
        <form class="panel" onSubmit={submit} noValidate>
          <fieldset class="field fieldset">
            <legend class="field-label">Game</legend>
            <label class="radio"><input type="radio" name="game" value="finals" checked={finals} onChange={set('game')} /> The Finals</label>
            <label class="radio"><input type="radio" name="game" value="other" checked={!finals} onChange={set('game')} /> Other game (set by cm/360)</label>
          </fieldset>
          {field('dpi', 'Mouse DPI', 'Whole number, from your mouse software.')}
          {finals
            ? field('sens', 'Your The Finals sens', 'Whole number, as in your game settings.')
            : field('sens', 'Your current cm/360', 'Distance your mouse travels for a full turn.')}
          <div class="row">
            {field('fov', 'FOV', 'Your in-game field of view.')}
            <label class="field">
              <span class="field-label">FOV type</span>
              <select class="input" value={f.fovType} onChange={set('fovType')}>
                <option value="horizontal">Horizontal</option>
                <option value="vertical">Vertical</option>
              </select>
            </label>
          </div>
          <div class="field">
            <span class="field-label">Play area (required)</span>
            <div class="row row-tight">
              <input class="input" type="text" inputMode="decimal" name="padWidthCm" value={f.padWidthCm} onInput={set('padWidthCm')}
                placeholder="cm" aria-invalid={errors.padWidthCm ? 'true' : undefined} />
              <button type="button" class="btn" onClick={() => onCalibrate(f)}>Calibrate</button>
            </div>
            <span class="field-hint">How far your mouse can travel on your pad. No test sens will be too slow for it.</span>
            {errors.padWidthCm && <span class="field-error" role="alert">{errors.padWidthCm}</span>}
          </div>
          <div class="actions">
            <button type="submit" class="btn btn-primary">Start</button>
            <button type="button" class="btn" onClick={onBack}>Back</button>
          </div>
        </form>
      )}
      {saved && <button type="button" class="link" onClick={onBack}>Back</button>}
    </main>
  );
}
