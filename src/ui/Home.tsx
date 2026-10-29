import './styles.css';
import { UNSUPPORTED_TEXT } from './Setup';

export interface HomeProps {
  unsupported: boolean;
  /** A Play-Along search is in progress. */
  playAlongSaved: boolean;
  onPlayAlong(): void;
  onStandard(): void;
  onHistory(): void;
  onDemo(): void;
}

/** The first screen: what the app does and which way to use it. */
export function Home({ unsupported, playAlongSaved, onPlayAlong, onStandard, onHistory, onDemo }: HomeProps) {
  return (
    <main class="page">
      <h1 class="title">Blind Sens Finder</h1>
      <p class="lede">Find the mouse sensitivity you actually aim best with, measured from how you play, not by feel alone.</p>
      {unsupported && <div class="notice" role="alert"><p>{UNSUPPORTED_TEXT}</p></div>}
      <p class="field-hint">Needs a desktop computer with a mouse, in Chrome or Edge.</p>

      <section class="panel home-card home-card-main">
        <p class="pa-label">Recommended</p>
        <h2>Play-Along</h2>
        <p>Play your game as usual. Between matches, come back for a 3-minute aim test on the sens the app suggests. After about 3 evenings you get your best sens, or an honest range if several perform the same.</p>
        <p class="field-hint">Want a look first? The next screen has a 5-minute Quick try.</p>
        <button type="button" class="btn btn-primary" disabled={unsupported} onClick={onPlayAlong}>
          {playAlongSaved ? 'Continue Play-Along' : 'Start Play-Along'}
        </button>
      </section>

      <section class="panel home-card">
        <h2>One-sitting test</h2>
        <p>About 12 minutes in one go, no game needed. Quicker, but less reliable: each sens is tested cold, without a match to get used to it first.</p>
        <button type="button" class="btn" disabled={unsupported} onClick={onStandard}>Start one-sitting test</button>
      </section>

      <div class="actions">
        <button type="button" class="btn" onClick={onHistory}>History</button>
        <button type="button" class="link" onClick={onDemo}>Watch a demo</button>
      </div>
    </main>
  );
}
