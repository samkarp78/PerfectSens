import type { MoveSample } from '../core/types';

export type LockResult = 'raw' | 'unsupported' | 'denied';

function lockErrorResult(err: unknown): LockResult {
  return (err as { name?: string } | null)?.name === 'NotSupportedError' ? 'unsupported' : 'denied';
}

export async function requestRawPointerLock(el: { requestPointerLock(opts?: unknown): unknown }): Promise<LockResult> {
  let ret: unknown;
  try {
    ret = el.requestPointerLock({ unadjustedMovement: true });
  } catch (err) {
    return lockErrorResult(err);
  }
  // The legacy API returns nothing and cannot guarantee raw input.
  if (!ret || typeof (ret as { then?: unknown }).then !== 'function') return 'unsupported';
  try {
    await (ret as Promise<unknown>);
    return 'raw';
  } catch (err) {
    return lockErrorResult(err);
  }
}

type MoveLike = { timeStamp: number; movementX: number; movementY: number };

export function samplesFromEvent(e: MoveLike & { getCoalescedEvents?(): unknown[] }): MoveSample[] {
  const list = typeof e.getCoalescedEvents === 'function' ? (e.getCoalescedEvents() as MoveLike[]) : [];
  const src: MoveLike[] = list.length > 0 ? list : [e];
  return src.map((m) => ({ t: m.timeStamp, dx: m.movementX, dy: m.movementY }));
}

export function startCapture(
  target: Document,
  onMove: (s: MoveSample) => void,
  onClick: (t: number) => void,
  onLockLost: () => void,
  onRelease: (t: number) => void = () => {},
): () => void {
  const moveType = 'onpointerrawupdate' in window ? 'pointerrawupdate' : 'pointermove';
  const onPointer = (e: Event) => {
    for (const s of samplesFromEvent(e as PointerEvent)) onMove(s);
  };
  const onDown = (e: MouseEvent) => {
    if (e.button === 0) onClick(e.timeStamp);
  };
  const onUp = (e: MouseEvent) => {
    if (e.button === 0) onRelease(e.timeStamp);
  };
  const onLockChange = () => {
    if (target.pointerLockElement === null) onLockLost();
  };
  target.addEventListener(moveType, onPointer);
  target.addEventListener('mousedown', onDown);
  target.addEventListener('mouseup', onUp);
  target.addEventListener('pointerlockchange', onLockChange);
  return () => {
    target.removeEventListener(moveType, onPointer);
    target.removeEventListener('mousedown', onDown);
    target.removeEventListener('mouseup', onUp);
    target.removeEventListener('pointerlockchange', onLockChange);
  };
}
