/*
The zoom level's invariants, which are the two a component cannot check for itself: a level that
comes back from storage as anything at all still has to be a whole step inside the range, and the
default has to leave no `zoom` on <html> — a window nobody has zoomed should not have a scale in its
box tree, because `zoom: 1` is not free in every engine.
*/
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyZoom,
  clampZoomLevel,
  MAX_ZOOM_LEVEL,
  MIN_ZOOM_LEVEL,
  rememberZoomLevel,
  storedZoomLevel,
  zoomFactor,
  zoomLevelLabel,
} from '.';

describe('the level', () => {
  it('is VS Code’s 1.2 a step, compounding', () => {
    expect(zoomFactor(0)).toBe(1);
    expect(zoomFactor(1)).toBeCloseTo(1.2);
    expect(zoomFactor(2)).toBeCloseTo(1.44);
    expect(zoomFactor(-1)).toBeCloseTo(0.8333);
  });

  // What the status bar shows: the level, signed, so which way it has been moved is on screen and
  // not only in the size of everything.
  it('is labelled as a signed level, and 0 without a sign', () => {
    expect(zoomLevelLabel(0)).toBe('0');
    expect(zoomLevelLabel(2)).toBe('+2');
    expect(zoomLevelLabel(-3)).toBe('-3');
    expect(zoomLevelLabel(MAX_ZOOM_LEVEL)).toBe('+5');
    expect(zoomLevelLabel(MIN_ZOOM_LEVEL)).toBe('-5');
  });

  it('holds to whole steps inside the range', () => {
    expect(clampZoomLevel(2.4)).toBe(2);
    expect(clampZoomLevel(MAX_ZOOM_LEVEL + 3)).toBe(MAX_ZOOM_LEVEL);
    expect(clampZoomLevel(MIN_ZOOM_LEVEL - 3)).toBe(MIN_ZOOM_LEVEL);
  });

  // localStorage hands back strings, and a hand-edited one can be anything.
  it('reads a level that is not a number as no zoom at all', () => {
    expect(clampZoomLevel(NaN)).toBe(0);
    expect(clampZoomLevel(Infinity)).toBe(0);
  });
});

// Asserted through the calls rather than through the computed style: `zoom` is a real property in
// every browser the app runs in and in none of jsdom, which drops what it does not know, so reading
// the style back here would test the environment instead of the module.
describe('applying it', () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);
    document.documentElement.style.removeProperty('--z-zoom');
  });

  // `zoom` itself is asserted through the call: jsdom keeps the custom property but drops the
  // property it does not know, so reading it back would test the environment instead of the module.
  it('scales #root, and publishes the factor for the rules that need it', () => {
    const setProperty = vi.spyOn(root.style, 'setProperty');

    applyZoom(1);

    expect(setProperty).toHaveBeenCalledWith('zoom', String(1.2));
    expect(document.documentElement.style.getPropertyValue('--z-zoom')).toBe(String(1.2));
    setProperty.mockRestore();
  });

  it('leaves no zoom behind at the default, rather than a redundant `zoom: 1`', () => {
    applyZoom(2);
    const removeProperty = vi.spyOn(root.style, 'removeProperty');

    applyZoom(0);

    expect(removeProperty).toHaveBeenCalledWith('zoom');
    expect(document.documentElement.style.getPropertyValue('--z-zoom')).toBe('');
    removeProperty.mockRestore();
  });

  // main.tsx throws on a missing #root by itself; this only has to not be the thing that throws.
  it('does nothing when there is no #root to scale', () => {
    root.remove();
    expect(() => applyZoom(2)).not.toThrow();
  });
});

describe('the remembered level', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('comes back as the level it was stored as', () => {
    rememberZoomLevel(-2);
    expect(storedZoomLevel()).toBe(-2);
  });

  it('is 0 when nothing has been stored, or when what was is not a level', () => {
    expect(storedZoomLevel()).toBe(0);
    localStorage.setItem('zasper.zoom', 'enormous');
    expect(storedZoomLevel()).toBe(0);
  });

  it('is a cache and not a requirement: neither call throws when storage is unavailable', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });

    expect(storedZoomLevel()).toBe(0);
    expect(() => rememberZoomLevel(3)).not.toThrow();

    getItem.mockRestore();
    setItem.mockRestore();
  });
});
