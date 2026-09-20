/**
 * Window zoom: a level rather than a font size, so every length scales —
 * the browser's own `zoom` rescales the CSS pixel itself.
 *
 * Kept in the browser rather than in ~/.zasper/config.json: zoom belongs to the screen being looked
 * at, not to the project.
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

/** What the status bar shows: the level, signed — `+2`, `0`, `-3`, rather than 1.44 or 144%. */
export function zoomLevelLabel(level: number): string {
  const clamped = clampZoomLevel(level);
  return clamped > 0 ? `+${clamped}` : String(clamped);
}

/**
 * On #root rather than <html>, because a viewport unit is not rescaled by `zoom`: zooming <html> left
 * `100vh` resolving against the unzoomed viewport and then multiplied, putting the app below the fold.
 * The chain is percentages instead (styles/_base.scss).
 *
 * The factor is published as --z-zoom for the few places that must keep a viewport unit, such as a
 * dialog capped at 90vh.
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
 * The factor in force, for the one thing that must undo it: a mouse coordinate is in window pixels
 * while what it positions is laid out in scaled ones.
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
