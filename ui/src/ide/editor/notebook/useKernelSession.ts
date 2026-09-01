import { useCallback, useState } from 'react';
import { useAtom } from 'jotai';
import { w3cwebsocket as W3CWebSocket } from 'websocket';

import { createSession, deleteSession, interruptKernel, ISession } from '../../../api';
import { BaseWebSocketUrl } from '../../config';
import { kernelsAtom, notebookKernelMapAtom, userNameAtom } from '../../../store/AppState';
import { IfileTab } from '../../../store/TabState';
import {
  buildExecuteRequest,
  buildInputReply,
  buildInspectRequest,
  IKernelMessage,
} from './kernelMessages';

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
  const [inspectReplyMessage, setInspectReplyMessage] = useState('');
  const [, setKernels] = useAtom(kernelsAtom);
  const [notebookKernelMap, setNotebookKernelMap] = useAtom(notebookKernelMapAtom);
  const [userName] = useAtom(userNameAtom);

  const toggleKernelSwitcher = () => setShowKernelSwitcher((prev) => !prev);
  const toggleErrorDialog = () => setShowErrorDialog((prev) => !prev);
  const toggleShowPrompt = () => setShowPrompt((prev) => !prev);

  const handleMessage = useCallback(
    (message: IKernelMessage) => {
      if (message.header.msg_type === 'input_request') {
        setShowPrompt(true);
        setPromptContent(message);
      }
      if (message.header.msg_type === 'inspect_reply') {
        setInspectReplyMessage(message.content.data['text/plain']);
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

      if (kernelspec === 'none') {
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

  const sendInspectRequest = (source: string, cursorPos: number) => {
    if (session) {
      connection.send(buildInspectRequest(session.id, userName, source, cursorPos));
    }
  };

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
    inspectReplyMessage,
    startTabSession,
    changeKernel,
    interruptKernel: interrupt,
    restartKernel,
    reconnectKernel,
    sendExecuteRequest,
    sendInputReply,
    sendInspectRequest,
  };
}

export type KernelSession = ReturnType<typeof useKernelSession>;
