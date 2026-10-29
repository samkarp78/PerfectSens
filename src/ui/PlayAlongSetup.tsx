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
  /** A quick try: about 5 minutes, 3 short tests, no match needed, not saved. */
  onQuickTry(setup: PaSetup): void;
  /** Quick try with the saved search's settings (the form is hidden while a search is saved). */
  onQuickTrySaved(): void;
  onContinue(): void;
  onStartFresh(): void;
  onBack(): void;
  /** The one-sitting test uses this same setup (no saved search, no quick try). */
  sitting?: boolean;
}

export function PlayAlongSetup({ fields: f, saved, onFields, onCalibrate, onStart, onQuickTry, onQuickTrySaved, onContinue, onStartFresh, onBack, sitting = false }: PlayAlongSetupProps) {
  const [errors, setErrors] = useState<Partial<Record<keyof PaFields, string>>>({});
  const set = (k: keyof PaFields) => (e: Event) => onFields({ ...f, [k]: (e.target as HTMLInputElement).value });
  const finals = f.game === 'finals';

  const validated = (go: (setup: PaSetup) => void) => {
    const r = validatePaSetup(f);
    if (!r.ok) { setErrors(r.errors); return; }
    setErrors({});
    go(r.setup);
  };
  const submit = (e: Event) => { e.preventDefault(); validated(onStart); };

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
      <h1 class="title">{sitting ? 'One-sitting test' : 'Play-Along mode'}</h1>
      <p class="lede">{sitting
        ? 'About 12 minutes in one go, no game needed: 8 short tests back to back, each on a hidden sens, scored the same way as Play-Along. Quicker, but less reliable, because there is no match to settle into each sens.'
        : 'Play a match on the sens the app suggests, come back for a 3-minute test, repeat. Expect about 3 evenings to a confident answer; you can stop at any check-in with a best guess. Quick try shows the whole flow in about 5 minutes.'}</p>
      {saved && !sitting && (
        <div class="panel">
          <p>You have a search in progress: <strong>{saved.rangeText}</strong>.</p>
          {saved.stale && <p class="field-warn">It's been over two weeks since your last test. Your aim may have changed since then.</p>}
          <div class="actions">
            <button type="button" class="btn btn-primary" onClick={onContinue}>Continue your search</button>
            <button type="button" class="btn" onClick={onStartFresh}>Start fresh</button>
            <button type="button" class="btn" onClick={onQuickTrySaved}
              title="About 5 minutes: 3 short tests, no match needed. Not saved and not a real answer.">Quick try (5 min)</button>
          </div>
        </div>
      )}
      {(!saved || sitting) && (
        <form class="panel" onSubmit={submit} noValidate>
          <fieldset class="field fieldset">
            <legend class="field-label">Game</legend>
            <label class="radio"><input type="radio" name="game" value="finals" checked={finals} onChange={set('game')} /> The Finals</label>
            <label class="radio"><input type="radio" name="game" value="other" checked={!finals} onChange={set('game')} /> Other game (set by cm/360)</label>
          </fieldset>
          {field('dpi', 'Mouse DPI', 'Whole number, from your mouse software.')}
          {finals
            ? field('sens', 'Your sens in The Finals', 'Whole number, as in your game settings.')
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
            {!sitting && <button type="button" class="btn" onClick={() => validated(onQuickTry)}
              title="About 5 minutes: 3 short tests, no match needed. Not saved and not a real answer.">Quick try (5 min)</button>}
            <button type="button" class="btn" onClick={onBack}>Back</button>
          </div>
        </form>
      )}
      {saved && <button type="button" class="link" onClick={onBack}>Back</button>}
    </main>
  );
}
