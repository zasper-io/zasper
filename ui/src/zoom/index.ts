/**
 * Window zoom, the way VS Code does it: a level rather than a font size. Every length in the app
 * scales — chrome, icons, borders, the tree's rows, the editor — because the browser's own `zoom`
 * rescales the CSS pixel itself instead of any one declaration.
 *
 * There used to be a second setting beside it — a `.zfont-N` ladder on the content alone, stepped by
 * a pair of palette commands — and it is gone: zoom moves every length in the window, including those.
 *
 * ~/.zasper/config.json does not carry it: zoom is a property of the screen being looked at, not of
 * the project, so it lives in the browser doing the looking.
 */

const STORAGE_KEY = 'zasper.zoom';

/** VS Code's ratio, so a level here means what a level means there: 20% a step, compounding. */
const RATIO = 1.2;

// Five steps either way is 2.5x and 0.4x, past which the 22px row stops being a row.
export const MIN_ZOOM_LEVEL = -5;
export const MAX_ZOOM_LEVEL = 5;

/** Whole steps only, and never NaN: this value comes back from localStorage as a string. */
export function clampZoomLevel(level: number): number {
  if (!Number.isFinite(level)) {
    return 0;
  }
  return Math.min(MAX_ZOOM_LEVEL, Math.max(MIN_ZOOM_LEVEL, Math.round(level)));
}

export function zoomFactor(level: number): number {
  return RATIO ** clampZoomLevel(level);
}

/**
 * What the status bar shows: the level itself, signed — `+2`, `0`, `-3`. The factor behind it is
 * 1.2 to that power and reads as 1.44 or 0.83, and the percentage reads as 144 or 83; the level is
 * the one of the three that is a small whole number and says which way it has been moved.
 */
export function zoomLevelLabel(level: number): string {
  const clamped = clampZoomLevel(level);
  return clamped > 0 ? `+${clamped}` : String(clamped);
}

/**
 * On #root rather than on <html>, and this is the one thing about `zoom` worth knowing: a viewport
 * unit is *not* rescaled by it. Zooming <html> left `.editor`'s `height: 100vh` resolving against the
 * unzoomed viewport and then multiplied by the factor — 1.44 put 358px of the app below the fold,
 * with a scrollbar down the window. The chain is percentages instead (`html, body, #root` in
 * styles/_base.scss), which Chrome does resolve across the zoom boundary, so the shell still ends
 * exactly at the bottom of the window at every level.
 *
 * The factor is published as --z-zoom for the few places that must keep a viewport unit: a dialog is
 * capped at 90vh, and that cap has to be 90% of the *window* rather than of the window times the
 * factor.
 */
export function applyZoom(level: number): void {
  const root = document.getElementById('root');
  if (root === null) {
    return;
  }
  const clamped = clampZoomLevel(level);

  // Removed rather than set to 1 at the default, so an unzoomed app has no zoom in its box tree.
  if (clamped === 0) {
    root.style.removeProperty('zoom');
    document.documentElement.style.removeProperty('--z-zoom');
  } else {
    const factor = String(zoomFactor(clamped));
    root.style.setProperty('zoom', factor);
    document.documentElement.style.setProperty('--z-zoom', factor);
  }
}

/**
 * The factor in force right now, for the one thing that has to undo it: a coordinate taken from a
 * mouse event is in the window's pixels, and anything positioned with it is laid out in the scaled
 * ones. Everything else in the app is a percentage or a flex box and needs no such correction.
 */
export function currentZoomFactor(): number {
  const declared = getComputedStyle(document.documentElement).getPropertyValue('--z-zoom').trim();
  const factor = Number(declared);
  return Number.isFinite(factor) && factor > 0 ? factor : 1;
}

/** The last level this browser applied. Never throws: a zoom level is not worth a boot. */
export function storedZoomLevel(): number {
  try {
    return clampZoomLevel(Number(localStorage.getItem(STORAGE_KEY) ?? 0));
  } catch {
    return 0;
  }
}

export function rememberZoomLevel(level: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(clampZoomLevel(level)));
  } catch {
    // Private browsing, or a full quota.
  }
}
