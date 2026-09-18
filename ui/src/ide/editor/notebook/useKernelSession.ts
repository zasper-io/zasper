import { useCallback, useEffect, useRef, useState } from 'react';
import { useAtom } from 'jotai';

import {
  apiErrorMessage,
  createSession,
  deleteSession,
  interruptKernel,
  NotebookMetadata,
  Session,
  sessionForPath,
} from '@/api';
import { kernelspecsAtom, notebookKernelMapAtom } from '@/store/kernels';
import { userNameAtom } from '@/store/serverInfo';
import { FileTab } from '@/store/tabState';
import { WidgetBridge } from '@/ide/widgets/widgetBridge';

import { kernelToStart, NO_KERNEL } from './kernelChoice';
import { decodeBuffers, KernelMessage } from './kernelMessages';
import { useInputPrompt } from './useInputPrompt';
import { useKernelRequests } from './useKernelRequests';
import { useKernelSocket } from './useKernelSocket';
import { useKernelStatus } from './useKernelStatus';

/**
 * The kernel side of a notebook tab: which session and kernel it is on, and starting, switching,
 * interrupting and restarting them. The socket, the requests sent over it, the kernel's status and its
 * input prompts are hooks of their own. Messages that change cells go to `applyMessage`, which the
 * notebook document provides.
 */
export function useKernelSession(
  tab: FileTab,
  applyMessage: (message: KernelMessage, cellId: string | undefined) => void
) {
  const [session, setSession] = useState<Session | null>();
  const [kernelName, setKernelName] = useState<string>(tab.kernelspec);
  const [kernelStatus, setKernelStatus] = useKernelStatus(session?.kernel.id);
  const [showKernelSwitcher, setShowKernelSwitcher] = useState<boolean>(false);
  /*
   * Why the last attempt to start a kernel failed, '' when none has. Shown inside the picker rather than
   * in a dialog of its own: a failure and "choose a kernel" are the same moment.
   */
  const [kernelError, setKernelError] = useState<string>('');
  const [notebookKernelMap, setNotebookKernelMap] = useAtom(notebookKernelMapAtom);
  const [userName] = useAtom(userNameAtom);
  const [kernelspecs] = useAtom(kernelspecsAtom);
  // In a ref because `startSessionForNotebook` reads it: as a dependency it would rebuild that callback
  // when the kernelspecs arrive, and the effect that opens a notebook would run twice.
  const installedKernels = useRef(kernelspecs);
  useEffect(() => {
    installedKernels.current = kernelspecs;
  }, [kernelspecs]);

  // What the kernel calls itself and its language, for the record a save leaves in the file. Undefined
  // until the kernelspecs have arrived.
  const kernelDisplayName = kernelspecs[kernelName]?.spec?.display_name;
  const kernelLanguage = kernelspecs[kernelName]?.spec?.language;

  const prompt = useInputPrompt();
  const socket = useKernelSocket(userName, (message) => handleMessage(message), setKernelStatus);
  const requests = useKernelRequests(session, socket.connection, userName);

  function handleMessage(message: KernelMessage) {
    const cellId = requests.cellFor(message);

    if (message.header.msg_type === 'input_request') {
      prompt.askForInput(message, cellId);
    }
    if (WidgetBridge.handles(message.header.msg_type)) {
      socket.liveWidgets.current?.handleKernelMessage({
        ...message,
        buffers: decodeBuffers(message.buffers),
      });
    }
    if (message.header.msg_type === 'status') {
      setKernelStatus(message.content.execution_state);
    }
    requests.settle(message);
    // An Output widget entered while the cell was running holds its output, and a cell whose output a
    // widget is holding shows none of its own.
    if (socket.liveWidgets.current?.captureOutput(message)) {
      return;
    }
    applyMessage(message, cellId);
  }

  const toggleKernelSwitcher = () => setShowKernelSwitcher((prev) => !prev);

  const { open: openSocket, setConnection } = socket;
  const startSession = useCallback(
    async (path: string, name: string, type: string, kernelspec: string) => {
      setKernelName(kernelspec);
      setKernelError('');

      if (kernelspec === NO_KERNEL) {
        setShowKernelSwitcher(true);
        return;
      }

      try {
        const data = await createSession(path, name, type, kernelspec);
        setSession(data);
        setNotebookKernelMap((prev) => ({ ...prev, [data.path]: data.kernel }));
        setConnection(await openSocket(data));
        return data;
      } catch (error: unknown) {
        // Recorded rather than shown: the caller decides what to raise, and the only useful thing to
        // raise is the picker.
        setKernelError(apiErrorMessage(error));
        throw error;
      }
    },
    [setNotebookKernelMap, openSocket, setConnection]
  );

  /** Starts a session for this tab, falling back to the kernel picker on failure. */
  const startTabSession = useCallback(
    (kernelspec: string) => {
      startSession(tab.path, tab.name, tab.type, kernelspec).catch((error) => {
        console.error('Failed to start session:', error);
        setShowKernelSwitcher(true);
      });
    },
    [startSession, tab.path, tab.name, tab.type]
  );

  /**
   * Starts the session for a notebook just read, or rejoins the one already running that file: closing
   * a tab leaves its kernel alive. The POST that follows is what joins it; the server answers a request
   * for a path it is already running with that session.
   */
  const startSessionForNotebook = useCallback(
    async (metadata: NotebookMetadata) => {
      // Failing to ask is not failing to start: with no answer the tab and the file decide.
      const running = await sessionForPath(tab.path).catch((error) => {
        console.error('Failed to look for a session already running this notebook:', error);
        return undefined;
      });

      startTabSession(
        kernelToStart(tab.kernelspec, metadata, installedKernels.current, running?.kernel.name)
      );
    },
    [startTabSession, tab.kernelspec, tab.path]
  );

  /** Moves this notebook to another kernel, ending the session it was on first. */
  const changeKernel = async (value: string) => {
    toggleKernelSwitcher();

    // Picking the kernel that is already running is a no-op, unless there is no session on it — which
    // is how the picker offers a second try at a kernel that failed to start.
    if (kernelName === value && session) {
      return;
    }

    if (session) {
      // Before the new session, not after: the server finds a session by path, so an abandoned one
      // leaves a kernel running with nothing attached and makes a reopened notebook's lookup ambiguous.
      try {
        await deleteSession(session.id);
      } catch (error) {
        console.error('Error deleting the previous session:', error);
      }
      setSession(null);
    }

    if (tab.path in notebookKernelMap) {
      setNotebookKernelMap((prev) => {
        const updated = { ...prev };
        delete updated[tab.path];
        return updated;
      });
    }

    startTabSession(value);
  };

  const interrupt = () => {
    if (!session) return;

    // Set now, not when the request resolves: the kernel's own `status: idle` usually beats the HTTP
    // reply, and writing 'interrupted' after it left the pill red-ringed until the next cell ran.
    setKernelStatus('interrupted');
    interruptKernel(session.kernel.id).catch((error) => {
      console.error('Error interrupting kernel:', error);
    });
  };

  const { forgetRunningCells } = requests;
  /** Drops the current session and starts a fresh one with the same kernel. */
  const restartKernel = useCallback(async () => {
    if (!session) return;

    // Without this a cell interrupted by the restart keeps its spinner for the rest of the session.
    forgetRunningCells();
    await deleteSession(session.id);
    await startSession(tab.path, tab.name, tab.type, kernelName);
  }, [session, startSession, tab.path, tab.name, tab.type, kernelName, forgetRunningCells]);

  const reconnectKernel = () => {
    if (session) {
      openSocket(session)
        .then((client) => {
          setConnection(client);
          setKernelStatus('connected');
        })
        .catch((error) => {
          console.error('Error reconnecting to kernel:', error);
        });
    }
  };

  return {
    session,
    kernelName,
    kernelDisplayName,
    kernelLanguage,
    kernelStatus,
    runningCellIds: requests.runningCellIds,
    connection: socket.connection,
    widgets: socket.widgets,
    showKernelSwitcher,
    toggleKernelSwitcher,
    kernelError,
    showPrompt: prompt.showPrompt,
    promptContent: prompt.promptContent,
    promptCellId: prompt.promptCellId,
    toggleShowPrompt: prompt.toggleShowPrompt,
    startTabSession,
    startSessionForNotebook,
    changeKernel,
    interruptKernel: interrupt,
    restartKernel,
    reconnectKernel,
    sendExecuteRequest: requests.sendExecuteRequest,
    sendInputReply: requests.sendInputReply,
    requestCompletions: requests.requestCompletions,
    requestInspection: requests.requestInspection,
  };
}

export type KernelSession = ReturnType<typeof useKernelSession>;
