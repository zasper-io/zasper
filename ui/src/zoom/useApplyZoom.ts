import { useEffect } from 'react';
import { useAtomValue } from 'jotai';

import { zoomLevelAtom } from '@/store/AppState';
import { applyZoom, rememberZoomLevel } from '.';

/**
 * Applies the zoom level whenever it changes, and remembers it for main.tsx to put back before the
 * next first render. Mounted by every route that registers the zoom commands: the IDE and /login.
 */
export function useApplyZoom(): void {
  const zoomLevel = useAtomValue(zoomLevelAtom);

  useEffect(() => {
    applyZoom(zoomLevel);
    rememberZoomLevel(zoomLevel);
  }, [zoomLevel]);
}
