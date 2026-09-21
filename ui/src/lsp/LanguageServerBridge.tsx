import { useEffect } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { toast } from 'react-toastify';

import { getInterpreters, getLanguageServers, logApiError } from '@/api';
import { baseName } from '@/paths';
import { languageServerListAtom, problemsAtom, serverStatusAtom } from '@/store/languageServers';
import { interpreterChoiceAtom } from '@/store/interpreters';
import { kernelspecsAtom } from '@/store/kernels';
import { projectDirAtom } from '@/store/serverInfo';
import { useTabActions } from '@/store/tabActions';
import {
  configurationChanged,
  setDisplayFile,
  setFallbackInterpreter,
  subscribeLanguageServers,
} from './servers';
import { interpreterOfKernel, setTypeChecking } from './settings';
import { waitForEditorView } from './views';

/**
 * Carries what the language servers say into the store, where the status bar, the Problems panel and the
 * file tree read it, and gives a jump into another file a way to open a tab.
 */
export default function LanguageServerBridge() {
  const root = useAtomValue(projectDirAtom);
  const kernelspecs = useAtomValue(kernelspecsAtom);
  const [interpreterChoice, setInterpreterChoice] = useAtom(interpreterChoiceAtom);
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

  // The Python chosen in Settings, or else the project's own environment, which Zasper already offers as a
  // kernel: what a file editor's imports are read with until a notebook names the interpreter of its kernel.
  useEffect(() => {
    const chosen = interpreterChoice?.chosen;
    setFallbackInterpreter(
      'python',
      chosen ? chosen : interpreterOfKernel(kernelspecs['project-venv'])
    );
  }, [interpreterChoice, kernelspecs]);

  useEffect(() => {
    if (root !== '') {
      getInterpreters()
        .then(setInterpreterChoice)
        .catch(logApiError('Error listing Python interpreters:'));
    }
  }, [root, setInterpreterChoice]);

  useEffect(() => {
    if (root !== '') {
      getLanguageServers()
        .then((list) => {
          setList(list);
          // Settings → Type checking, for the servers started in this window.
          setTypeChecking(list.typeChecking);
          configurationChanged();
        })
        .catch(logApiError('Error listing language servers:'));
    }
  }, [root, setList]);

  return null;
}
