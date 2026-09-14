import { atom } from 'jotai';

import { storedZoomLevel } from './index';

/** The whole window's scale, applied to <html> by useApplyZoom. Seeded from the browser, so a reload keeps it. */
export const zoomLevelAtom = atom<number>(storedZoomLevel());
