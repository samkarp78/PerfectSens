import { useEffect, useRef, useState } from 'preact/hooks';
import './styles.css';
import { defaultConfig } from '../core/config';
import { countsToCm } from '../core/geometry';
import { requestRawPointerLock, startCapture } from '../input/rawInput';

export interface CalibrateProps {
  dpi: number;
  onDone(padWidthCm: number): void;
  onCancel(): void;
  onUnsupported(): void;
}

/** Passes across the pad; the smallest span wins, so one over-long slide can't inflate the result. */
const PASSES = 2;

type Step = { kind: 'lock' } | { kind: 'left'; pass: number } | { kind: 'right'; pass: number } | { kind: 'done'; cm: number };

/**
 * Play-area calibration: with the mouse locked, click at the far left edge of the usable pad, slide to the far right
 * edge and click again. Raw counts between the clicks give the width in cm.
 */
export function Calibrate({ dpi, onDone, onCancel, onUnsupported }: CalibrateProps) {
  const areaRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState<Step>({ kind: 'lock' });
  const [live, setLive] = useState(0);
  const stepRef = useRef(step);
  stepRef.current = step;
  const counts = useRef(0);
  const widths = useRef<number[]>([]);

  useEffect(() => {
    const dispose = startCapture(
      document,
      (s) => {
        if (stepRef.current.kind !== 'right') return;
        counts.current += s.dx;
        setLive(countsToCm(counts.current, dpi));
      },
      () => {
        const st = stepRef.current;
        if (st.kind === 'left') {
          counts.current = 0;
          setLive(0);
          setStep({ kind: 'right', pass: st.pass });
        } else if (st.kind === 'right') {
          const cm = countsToCm(counts.current, dpi);
          // A pass shorter than any real pad is a slip (e.g. a double click): redo that pass.
          if (cm < defaultConfig.setup.padWidthCm.min) { setStep({ kind: 'left', pass: st.pass }); return; }
          widths.current.push(cm);
          if (st.pass + 1 < PASSES) setStep({ kind: 'left', pass: st.pass + 1 });
          else {
            setStep({ kind: 'done', cm: Math.min(...widths.current) });
            if (document.pointerLockElement) document.exitPointerLock();
          }
        }
      },
      () => { if (stepRef.current.kind !== 'done') setStep({ kind: 'lock' }); },
    );
    return () => { dispose(); if (document.pointerLockElement) document.exitPointerLock(); };
  }, [dpi]);

  const lock = async () => {
    const r = await requestRawPointerLock(areaRef.current!);
    if (r === 'unsupported') { onUnsupported(); return; }
    if (r === 'raw') { widths.current = []; setStep({ kind: 'left', pass: 0 }); }
  };

  const round1 = (x: number) => Math.round(x * 10) / 10;

  return (
    <main class="page">
      <h1 class="title">Play area calibration</h1>
      <p class="lede">
        Measures how far your mouse can travel on your pad, so the test never tries a sens too slow for your setup.
        Use the space you'd really use in game, not the very edge of the desk.
      </p>
      <div ref={areaRef} class="calib-area" role="button" tabIndex={0}
        onClick={() => { if (step.kind === 'lock') void lock(); }}>
        {step.kind === 'lock' && <p class="calib-step">Click here to lock the mouse and begin.</p>}
        {step.kind === 'left' && (
          <p class="calib-step">Pass {step.pass + 1} of {PASSES}: move your mouse to the <strong>far left</strong> of your play area, then click.</p>
        )}
        {step.kind === 'right' && (
          <>
            <p class="calib-step">Now slide to the <strong>far right</strong> of your play area and click.</p>
            <p class="calib-live">{round1(live)} cm</p>
          </>
        )}
        {step.kind === 'done' && <p class="calib-live">Your play area: {round1(step.cm)} cm</p>}
      </div>
      <div class="actions">
        {step.kind === 'done' && <button type="button" class="btn btn-primary" onClick={() => onDone(round1(step.cm))}>Use this</button>}
        {step.kind === 'done' && <button type="button" class="btn" onClick={() => setStep({ kind: 'lock' })}>Redo</button>}
        <button type="button" class="btn" onClick={onCancel}>Cancel</button>
      </div>
    </main>
  );
}
