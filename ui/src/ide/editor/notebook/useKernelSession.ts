import { useCallback, useEffect, useRef, useState } from 'react';
import { useAtom } from 'jotai';
import { w3cwebsocket as W3CWebSocket } from 'websocket';
import { v4 as uuidv4 } from 'uuid';

import { createSession, deleteSession, interruptKernel, INotebookMetadata, ISession } from '@/api';
import { BaseWebSocketUrl } from '@/config';
import {
  IKernelspecsState,
  kernelsAtom,
  kernelspecsAtom,
  notebookKernelMapAtom,
  userNameAtom,
} from '@/store/AppState';
import { IfileTab } from '@/store/TabState';
import {
  buildCompleteRequest,
  buildExecuteRequest,
  buildInputReply,
  ICompleteReply,
  IKernelMessage,
} from './kernelMessages';

/**
 * How long to wait for a `complete_reply` before giving up on it.
 *
 * A kernel handles shell messages one at a time, so a completion asked for while a cell is
 * running is not answered until that cell finishes — by which point the editor has moved on and
 * the answer is wrong. Better to drop it than to pop a stale list over the cursor.
 */
const COMPLETION_TIMEOUT_MS = 2000;

/** The kernelspec a tab carries when it does not know one, i.e. "ask which kernel". */
export const NO_KERNEL = 'none';

/**
 * Which kernel to start for a notebook that has just been read.
 *
 * Only the Launcher's "new notebook" knows a kernel up front; every other way of opening one passes
 * 'none', so `metadata.kernelspec` is the only record of the kernel the file was saved with.
 * Returns 'none' when there is no usable answer, which is what raises the picker.
 */
export function kernelToStart(
  tabKernelspec: string,
  metadata: INotebookMetadata,
  installed: IKernelspecsState
): string {
  // A kernel chosen for this tab outranks the file: for a notebook created from the Launcher the
  // file names none at all.
  if (tabKernelspec !== '' && tabKernelspec !== NO_KERNEL) {
    return tabKernelspec;
  }

  // Zasper wrote a bare string here before, so both shapes are on disk.
  const saved =
    typeof metadata.kernelspec === 'string' ? metadata.kernelspec : metadata.kernelspec?.name;
  if (saved === undefined || saved === '' || saved === NO_KERNEL) {
    return NO_KERNEL;
  }

  // Ask rather than fail: a notebook written elsewhere can name a kernel that is not installed
  // here. An empty list means the kernelspecs have not been fetched yet, which is no evidence that
  // the kernel is missing.
  if (Object.keys(installed).length > 0 && !(saved in installed)) {
    return NO_KERNEL;
  }

  return saved;
}

type IKernelWebSocketClient = W3CWebSocket;

/** Stand-in until the real socket is connected, so senders never hit a null client. */
const disconnectedClient = {
  send: () => {},
  close: () => {},
  onopen: () => {},
  onmessage: () => {},
  onerror: () => {},
  onclose: () => {},
} as unknown as IKernelWebSocketClient;

/**
 * Owns the kernel side of a notebook tab: the session, the websocket carrying
 * kernel messages, and the dialogs driven by kernel state. Messages that mutate
 * cells are handed to `applyMessage`, which the notebook document hook provides.
 */
export function useKernelSession(tab: IfileTab, applyMessage: (message: IKernelMessage) => void) {
  const [session, setSession] = useState<ISession | null>();
  const [kernelName, setKernelName] = useState<string>(tab.kernelspec);
  const [kernelStatus, setKernelStatus] = useState('idle');
  const [connection, setConnection] = useState<IKernelWebSocketClient>(disconnectedClient);
  const [showKernelSwitcher, setShowKernelSwitcher] = useState<boolean>(false);
  const [showErrorDialog, setShowErrorDialog] = useState<boolean>(false);
  const [showPrompt, setShowPrompt] = useState<Boolean>(false);
  const [promptContent, setPromptContent] = useState<IKernelMessage>();
  // Keyed by the request's msg_id, which is what a reply's parent_header carries. A ref rather
  // than state: resolving a promise is not a render, and the callbacks have to survive one.
  const pendingCompletions = useRef(new Map<string, (reply: ICompleteReply) => void>());
  const [, setKernels] = useAtom(kernelsAtom);
  const [notebookKernelMap, setNotebookKernelMap] = useAtom(notebookKernelMapAtom);
  const [userName] = useAtom(userNameAtom);
  const [kernelspecs] = useAtom(kernelspecsAtom);
  // In a ref because `startSessionForNotebook` reads it: as a dependency it would rebuild that
  // callback when the kernelspecs arrive, and the effect that opens a notebook would run twice.
  const installedKernels = useRef(kernelspecs);
  useEffect(() => {
    installedKernels.current = kernelspecs;
  }, [kernelspecs]);

  const toggleKernelSwitcher = () => setShowKernelSwitcher((prev) => !prev);
  const toggleErrorDialog = () => setShowErrorDialog((prev) => !prev);
  const toggleShowPrompt = () => setShowPrompt((prev) => !prev);

  const handleMessage = useCallback(
    (message: IKernelMessage) => {
      if (message.header.msg_type === 'input_request') {
        setShowPrompt(true);
        setPromptContent(message);
      }
      if (message.header.msg_type === 'complete_reply') {
        pendingCompletions.current.get(message.parent_header.msg_id)?.(message.content);
      }
      if (message.header.msg_type === 'status') {
        setKernelStatus(message.content.execution_state);
      }
      applyMessage(message);
    },
    [applyMessage]
  );

  const startWebSocket = useCallback(
    (newSession: ISession | null | undefined): Promise<IKernelWebSocketClient> => {
      if (!newSession) return Promise.reject('No session provided');

      return new Promise<IKernelWebSocketClient>((resolve, reject) => {
        const client = new W3CWebSocket(
          BaseWebSocketUrl +
            '/ws/kernels/' +
            newSession.kernel.id +
            '/channels?session_id=' +
            newSession.id
        );

        client.onopen = () => {
          setKernelStatus('connected');
          resolve(client);
        };

        client.onmessage = (message) => {
          handleMessage(JSON.parse(message.data as string));
        };

        client.onerror = (error) => {
          console.error('WebSocket error:', error);
          reject(error);
        };

        // The server closes the channel when the kernel dies, so this is how a
        // notebook learns its kernel is gone.
        client.onclose = () => {
          setKernelStatus('disconnected');
        };
      });
    },
    [handleMessage]
  );

  const startSession = useCallback(
    async (path: string, name: string, type: string, kernelspec: string) => {
      setKernelName(kernelspec);

      if (kernelspec === NO_KERNEL) {
        setShowKernelSwitcher(true);
        return; // Resolve immediately, no kernel
      }

      try {
        const data = await createSession(path, name, type, kernelspec);

        setSession(data);

        setKernels((prev) => ({ ...prev, [data.kernel.id]: data.kernel }));
        setNotebookKernelMap((prev) => ({ ...prev, [data.path]: data.kernel }));

        setConnection(await startWebSocket(data));

        return data;
      } catch (error: unknown) {
        setShowErrorDialog(true);
        console.log('error starting session:', error);
        throw error;
      }
    },
    [setKernels, setNotebookKernelMap, startWebSocket]
  );

  /** Starts a session for this tab, falling back to the kernel picker on failure. */
  const startTabSession = useCallback(
    (kernelspec: string) => {
      startSession(tab.path, tab.name, tab.type, kernelspec).catch((error) => {
        console.error('Failed to start session:', error);
        setShowKernelSwitcher(true); // Show kernel switcher if session fails
      });
    },
    [startSession, tab.path, tab.name, tab.type]
  );

  /** Starts the session for a notebook just read, on the kernel `kernelToStart` picks for it. */
  const startSessionForNotebook = useCallback(
    (metadata: INotebookMetadata) => {
      startTabSession(kernelToStart(tab.kernelspec, metadata, installedKernels.current));
    },
    [startTabSession, tab.kernelspec]
  );

  const changeKernel = (value: string) => {
    if (tab.path in notebookKernelMap) {
      const kernelId = notebookKernelMap[tab.path].id;

      setNotebookKernelMap((prev) => {
        const updated = { ...prev };
        delete updated[tab.path];
        return updated;
      });

      setKernels((prev) => {
        const updated = { ...prev };
        delete updated[kernelId];
        return updated;
      });
    }
    if (kernelName !== value) {
      setKernelName(value);
      startTabSession(value);
    }
    toggleKernelSwitcher();
  };

  const interrupt = () => {
    if (session) {
      interruptKernel(session.kernel.id)
        .then(() => setKernelStatus('interrupted'))
        .catch((error) => console.error('Error interrupting kernel:', error));
    }
  };

  /** Drops the current session and starts a fresh one with the same kernel. */
  const restartKernel = useCallback(async () => {
    if (!session) return;

    await deleteSession(session.id);
    await startSession(tab.path, tab.name, tab.type, kernelName);
  }, [session, startSession, tab.path, tab.name, tab.type, kernelName]);

  const reconnectKernel = () => {
    if (session) {
      startWebSocket(session)
        .then((client) => {
          setConnection(client);
          setKernelStatus('connected');
        })
        .catch((error) => {
          console.error('Error reconnecting to kernel:', error);
        });
    }
  };

  const sendExecuteRequest = useCallback(
    (source: string, cellId: string) => {
      if (session && connection && connection.readyState === WebSocket.OPEN) {
        try {
          connection.send(buildExecuteRequest(session.id, userName, cellId, source));
        } catch (error) {
          console.error('Failed to send execute_request message:', error);
        }
      }
    },
    [session, connection, userName]
  );

  const sendInputReply = (cellId: string, parentHeader: IKernelMessage, inputValue: string) => {
    if (session) {
      connection.send(buildInputReply(session.id, userName, cellId, parentHeader, inputValue));
    }
  };

  /**
   * Asks the kernel what completes at `cursorPos` in `source`, resolving null when there is no
   * live kernel to ask or when nothing arrives inside COMPLETION_TIMEOUT_MS. Callers get a
   * promise per request rather than a piece of state, because two keystrokes can have requests
   * in flight at once and only the newer answer is wanted.
   */
  const requestCompletions = useCallback(
    (source: string, cursorPos: number): Promise<ICompleteReply | null> => {
      if (!session || !connection || connection.readyState !== WebSocket.OPEN) {
        return Promise.resolve(null);
      }

      const msgId = uuidv4();

      return new Promise((resolve) => {
        const timer = window.setTimeout(() => {
          pendingCompletions.current.delete(msgId);
          resolve(null);
        }, COMPLETION_TIMEOUT_MS);

        pendingCompletions.current.set(msgId, (reply) => {
          window.clearTimeout(timer);
          pendingCompletions.current.delete(msgId);
          resolve(reply);
        });

        try {
          connection.send(buildCompleteRequest(session.id, userName, msgId, source, cursorPos));
        } catch (error) {
          console.error('Failed to send complete_request message:', error);
          window.clearTimeout(timer);
          pendingCompletions.current.delete(msgId);
          resolve(null);
        }
      });
    },
    [session, connection, userName]
  );

  return {
    session,
    kernelName,
    kernelStatus,
    connection,
    showKernelSwitcher,
    toggleKernelSwitcher,
    showErrorDialog,
    toggleErrorDialog,
    showPrompt,
    promptContent,
    toggleShowPrompt,
    startTabSession,
    startSessionForNotebook,
    changeKernel,
    interruptKernel: interrupt,
    restartKernel,
    reconnectKernel,
    sendExecuteRequest,
    sendInputReply,
    requestCompletions,
  };
}

export type KernelSession = ReturnType<typeof useKernelSession>;
