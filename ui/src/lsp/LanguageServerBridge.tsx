import { useEffect } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { toast } from 'react-toastify';

import { getLanguageServers, logApiError } from '@/api';
import { baseName } from '@/paths';
import { languageServerListAtom, problemsAtom, serverStatusAtom } from '@/store/languageServers';
import { projectDirAtom } from '@/store/serverInfo';
import { useTabActions } from '@/store/tabActions';
import { setDisplayFile, subscribeLanguageServers } from './servers';
import { waitForEditorView } from './views';

/**
 * Carries what the language servers say into the store, where the status bar, the Problems panel and the
 * file tree read it, and gives a jump into another file a way to open a tab.
 */
export default function LanguageServerBridge() {
  const root = useAtomValue(projectDirAtom);
  const setStatus = useSetAtom(serverStatusAtom);
  const setProblems = useSetAtom(problemsAtom);
  const setList = useSetAtom(languageServerListAtom);
  const { openTab } = useTabActions();

  useEffect(
    () =>
      subscribeLanguageServers({
        status: (server, status) => setStatus((all) => ({ ...all, [server]: status })),
        message: (_server, kind, text) =>
          kind === 'error' ? toast.error(text) : toast.warning(text),
        problems: (path, list) =>
          setProblems((all) => {
            if (list.length > 0) {
              return { ...all, [path]: list };
            }
            if (!(path in all)) {
              return all;
            }
            const rest = { ...all };
            delete rest[path];
            return rest;
          }),
      }),
    [setStatus, setProblems]
  );

  useEffect(() => {
    setDisplayFile((path) => {
      openTab({ name: baseName(path), path, type: 'file' });
      return waitForEditorView(path);
    });
  }, [openTab]);

  useEffect(() => {
    if (root !== '') {
      getLanguageServers().then(setList).catch(logApiError('Error listing language servers:'));
    }
  }, [root, setList]);

  return null;
}
