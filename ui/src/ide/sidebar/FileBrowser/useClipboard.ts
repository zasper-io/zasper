import { useAtom } from 'jotai';

import { clipboardAtom } from './atoms';
import { useContentActions } from './useContentActions';

export interface IClipboard {
  /** What Cut or Copy set aside, if anything. Paste is only worth offering while this is set. */
  held: { paths: string[]; cut: boolean } | null;
  cut: (paths: string[]) => void;
  copy: (paths: string[]) => void;
  /** Carries out what is held into `toDir`. */
  paste: (toDir: string) => Promise<void>;
}

/**
 * One clipboard for the whole panel, so a row can be cut in one folder and pasted in another. Nothing
 * happens on disk until the paste: a cut that is never pasted has moved nothing, which is what makes
 * Escape-ing out of it safe.
 */
export function useClipboard(): IClipboard {
  const [held, setHeld] = useAtom(clipboardAtom);
  const { moveTo, copyTo } = useContentActions();

  return {
    held,
    cut: (paths: string[]) => setHeld({ paths, cut: true }),
    copy: (paths: string[]) => setHeld({ paths, cut: false }),
    paste: async (toDir: string) => {
      if (held === null) {
        return;
      }
      const done = held.cut ? await moveTo(held.paths, toDir) : await copyTo(held.paths, toDir);
      // A cut is spent once what it held has moved; a copy stays, so the same files can be pasted
      // into several folders in a row.
      if (done && held.cut) {
        setHeld(null);
      }
    },
  };
}
