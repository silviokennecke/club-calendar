/** Pure decision logic of the bottom-sheet drag (`useSheetDrag`). */

/** Apple's rubber band: `o` raw offset beyond the limit, `d` the dimension it stretches over. */
export function rubberBand(offset: number, dimension: number, constant = 0.55): number {
  if (offset === 0 || dimension <= 0) return 0;
  const abs = Math.abs(offset);
  const result = (abs * dimension * constant) / (dimension + constant * abs);
  return offset < 0 ? -result : result;
}

/** Sheet offset for a raw finger offset: 1:1 downwards, rubber-banded upwards. */
export function sheetOffset(raw: number, sheetHeight: number): number {
  return raw >= 0 ? raw : rubberBand(raw, sheetHeight);
}

export interface DragSample {
  y: number;
  t: number;
}

/** Velocity in px/s over the last `count` samples (positive = downwards). */
export function releaseVelocity(samples: DragSample[], count = 5): number {
  const last = samples.slice(-count);
  if (last.length < 2) return 0;
  const first = last[0];
  const end = last[last.length - 1];
  const dt = end.t - first.t;
  return dt > 0 ? ((end.y - first.y) / dt) * 1000 : 0;
}

/** Where the sheet would come to rest: offset plus inertia (UIScrollView deceleration rate). */
export function projectEnd(offset: number, velocity: number, rate = 0.998): number {
  return offset + ((velocity / 1000) * rate) / (1 - rate);
}

export const FLICK_VELOCITY = 600;

/** Dismiss when the projected end passes half the sheet or the flick down is fast enough. */
export function shouldDismiss(offset: number, velocity: number, sheetHeight: number): boolean {
  if (offset <= 0) return false;
  if (velocity > FLICK_VELOCITY) return true;
  return projectEnd(offset, velocity) > sheetHeight * 0.5;
}
