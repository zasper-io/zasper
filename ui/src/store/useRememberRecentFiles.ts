import { useEffect, useRef } from 'react';
import { useAtom, useAtomValue } from 'jotai';

import { projectDirAtom } from '@/store/serverInfo';
import { mergedRecent, readRecentFiles, recentFilesAtom, rememberRecentFiles } from './recentFiles';

/**
 * Keeps the recent files in step with what is opened, and reads back the ones this project had.
 *
 * Mounted once, from IDE.tsx, as `useRememberTabs` is — and like it, nothing is read or written until
 * `/api/info` has said which project this is: the paths belong to one project, and two projects served
 * on the same port share an origin and so a store.
 */
export function useRememberRecentFiles(): void {
  const [files, setFiles] = useAtom(recentFilesAtom);
  const directory = useAtomValue(projectDirAtom);
  const read = useRef(false);

  useEffect(() => {
    if (directory === '') {
      return;
    }

    // The read first, and only once: a file opened before the directory arrived stays in front of
    // what was remembered. The write for the merged list comes on the next run, from the state change.
    if (!read.current) {
      read.current = true;
      const stored = readRecentFiles(directory);
      if (stored.length > 0) {
        setFiles((current) => mergedRecent(current, stored));
        return;
      }
    }

    rememberRecentFiles(directory, files);
  }, [directory, files, setFiles]);
}
