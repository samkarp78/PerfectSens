import { useState } from 'preact/hooks';
import './styles.css';
import { validatePaSetup } from '../core/playalong/setup';
import type { PaSetup } from '../core/playalong/state';

const UNSUPPORTED_TEXT = "Raw mouse input isn't supported in this browser. Use Chrome or Edge on a desktop computer.";
const QUICK_TRY_TITLE = 'About 5 minutes: 3 short tests, no match needed. Not saved and not a real answer.';

/** The mouse settings form, as typed (validated when a mode starts). */
export type PaFields = { game: string; dpi: string; sens: string; fov: string; fovType: string; padWidthCm: string };
/** A saved Play-Along search to continue: its range text, and whether it has gone stale. */
export interface SavedSearch { rangeText: string; stale: boolean }

export interface HomeProps {
  unsupported: boolean;
  fields: PaFields;
  onFields(f: PaFields): void;
  sound: boolean;
  onSound(on: boolean): void;
  onCalibrate(): void;
  saved: SavedSearch | null;
  onPlayAlong(setup: PaSetup): void;
  onContinue(): void;
  onStartFresh(): void;
  onQuickTry(setup: PaSetup): void;
  onSitting(setup: PaSetup): void;
  onHistory(): void;
}

/** The first screen: your mouse settings once, then the two ways to find your sens. */
export function Home(p: HomeProps) {
  const { fields: f, unsupported } = p;
  const [errors, setErrors] = useState<Partial<Record<keyof PaFields, string>>>({});
  const set = (k: keyof PaFields) => (e: Event) => p.onFields({ ...f, [k]: (e.target as HTMLInputElement).value });
  const finals = f.game === 'finals';
  /** Starts a mode with the settings, or shows what's missing. */
  const go = (start: (setup: PaSetup) => void) => {
    const r = validatePaSetup(f);
    if (!r.ok) { setErrors(r.errors); return; }
    setErrors({});
    start(r.setup);
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
      <h1 class="title">Blind Sens Finder</h1>
      <p class="lede">Find the mouse sensitivity you actually aim best with, measured from how you play, not by feel alone.</p>
      {unsupported && <div class="notice" role="alert"><p>{UNSUPPORTED_TEXT}</p></div>}
      <p class="field-hint">Needs a desktop computer with a mouse, in Chrome or Edge.</p>

      <section class="panel">
        <h2>Your mouse settings</h2>
        <fieldset class="field fieldset">
          <legend class="field-label">Game</legend>
          <label class="radio"><input type="radio" name="game" value="finals" checked={finals} onChange={set('game')} /> The Finals (use your in-game sens number)</label>
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
          <span class="field-label">Play area</span>
          <div class="row row-tight">
            <input class="input" type="text" inputMode="decimal" name="padWidthCm" value={f.padWidthCm} onInput={set('padWidthCm')}
              placeholder="cm" aria-invalid={errors.padWidthCm ? 'true' : undefined} />
            <button type="button" class="btn" disabled={unsupported} onClick={p.onCalibrate}>Measure</button>
          </div>
          <span class="field-hint">How far your mouse can travel on your pad. No test sens will be too slow for it.</span>
          {errors.padWidthCm && <span class="field-error" role="alert">{errors.padWidthCm}</span>}
        </div>
        <label class="radio"><input type="checkbox" checked={p.sound} onChange={(e) => p.onSound((e.target as HTMLInputElement).checked)} /> Sound effects</label>
      </section>

      <section class="panel home-card home-card-main">
        <p class="pa-label">Recommended</p>
        <h2>Play-Along</h2>
        <p>Play your game as usual. Between matches, come back for a 3-minute aim test on the sens the app suggests. After about 3 evenings you get your best sens, or an honest range if several perform the same.</p>
        {p.saved ? (
          <>
            <p>You have a search in progress: <strong>{p.saved.rangeText}</strong>.</p>
            {p.saved.stale && <p class="field-warn">It's been over two weeks since your last test. Your aim may have changed since then.</p>}
            <div class="actions">
              <button type="button" class="btn btn-primary" disabled={unsupported} onClick={p.onContinue}>Continue your search</button>
              <button type="button" class="btn" onClick={p.onStartFresh}>Start fresh</button>
            </div>
          </>
        ) : (
          <div class="actions">
            <button type="button" class="btn btn-primary" disabled={unsupported} onClick={() => go(p.onPlayAlong)}>Start Play-Along</button>
            <button type="button" class="btn" disabled={unsupported} onClick={() => go(p.onQuickTry)} title={QUICK_TRY_TITLE}>Quick try (5 min)</button>
          </div>
        )}
      </section>

      <section class="panel home-card">
        <h2>One-sitting test</h2>
        <p>About 12 minutes in one go, no game needed: 8 short tests back to back, scored the same way as Play-Along. Quicker, but less reliable, because there is no match to settle into each sens.</p>
        <button type="button" class="btn" disabled={unsupported} onClick={() => go(p.onSitting)}>Start one-sitting test</button>
      </section>

      <div class="actions">
        <button type="button" class="btn" onClick={p.onHistory}>History</button>
      </div>
    </main>
  );
}
