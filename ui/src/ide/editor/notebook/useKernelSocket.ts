import { useCallback, useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';

import { Session, websocketUrl } from '@/api';
import { WidgetBridge } from '@/ide/widgets/widgetBridge';

import { buildWidgetMessage, KernelMessage } from './kernelMessages';

/** Stand-in until the real socket is connected, so senders never hit a null client. */
const disconnectedClient = {
  send: () => {},
  close: () => {},
  onopen: () => {},
  onmessage: () => {},
  onerror: () => {},
  onclose: () => {},
} as unknown as WebSocket;

/**
 * The websocket to a session's kernel, and the widget runtime that lives on it. Widget models belong to
 * a kernel, so every connection gets a runtime of its own and a replaced one lets go of its models.
 */
export function useKernelSocket(
  userName: string,
  onMessage: (message: KernelMessage) => void,
  setKernelStatus: (status: string) => void
) {
  const [connection, setConnection] = useState<WebSocket>(disconnectedClient);
  const [widgets, setWidgets] = useState<WidgetBridge | null>(null);
  // Also in refs, because a socket's handlers are set once and outlive every render.
  const liveWidgets = useRef<WidgetBridge | null>(null);
  const handleMessage = useRef(onMessage);
  handleMessage.current = onMessage;
  // Sockets opened but not yet `connection`, which the effect that closes the connection cannot see.
  const pendingSockets = useRef(new Set<WebSocket>());

  /** Opens a socket to the session's kernel, resolving once it is open. */
  const open = useCallback(
    (session: Session | null | undefined): Promise<WebSocket> => {
      if (!session) return Promise.reject('No session provided');

      return new Promise<WebSocket>((resolve, reject) => {
        const client = new WebSocket(
          websocketUrl(`/ws/kernels/${session.kernel.id}/channels`, { session_id: session.id })
        );
        pendingSockets.current.add(client);

        // Only once the socket is open: a widget output on a reloaded page asks the kernel about the
        // widgets it already has, and a question sent before the socket is up is heard by nobody.
        client.onopen = () => {
          const bridge = new WidgetBridge((msgType, content, metadata, buffers) => {
            const msgId = uuidv4();
            try {
              client.send(
                buildWidgetMessage(session.id, userName, msgId, msgType, content, metadata, buffers)
              );
            } catch (error) {
              console.error('Failed to send a widget message:', error);
            }
            return msgId;
          });
          liveWidgets.current = bridge;
          setWidgets(bridge);

          setKernelStatus('connected');
          resolve(client);
        };

        client.onmessage = (message) => {
          handleMessage.current(JSON.parse(message.data as string));
        };

        client.onerror = (error) => {
          console.error('WebSocket error:', error);
          reject(error);
        };

        // The server closes the channel when the kernel dies, so this is how a notebook learns its
        // kernel is gone.
        client.onclose = () => {
          setKernelStatus('disconnected');
        };
      });
    },
    [userName, setKernelStatus]
  );

  // A tab closing, or a kernel being replaced, takes its widgets with it.
  useEffect(() => () => widgets?.dispose(), [widgets]);

  /*
   * And it lets go of the socket, which nothing else closes: the kernel survives its client going away.
   * `onclose` is dropped first, because the `disconnected` it reports is true of the socket and not of
   * the kernel, and on a reconnect it would overwrite the state of the connection that replaced it.
   */
  useEffect(() => {
    if (connection === disconnectedClient) {
      return;
    }
    pendingSockets.current.delete(connection);
    return () => {
      connection.onclose = () => {};
      connection.close();
    };
  }, [connection]);

  // A tab closed while its kernel was still connecting: that socket never became `connection`.
  useEffect(() => {
    const pending = pendingSockets.current;
    return () => {
      for (const client of pending) {
        client.onclose = () => {};
        client.close();
      }
      pending.clear();
    };
  }, []);

  return { connection, setConnection, widgets, liveWidgets, open };
}
