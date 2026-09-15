import { Transport } from '@codemirror/lsp-client';

/** Why the server closed the socket, by the close codes internal/lsp sends. */
export const CLOSE_TURNED_OFF = 4001;
export const CLOSE_NOT_INSTALLED = 4002;
export const CLOSE_EXITED = 4003;

export interface SocketTransport extends Transport {
  close: () => void;
}

/**
 * A transport over one websocket: resolves once the socket is open, and reports the close with its code
 * and reason, which is how a missing or crashed server is told from one that is simply stopped.
 */
export function openSocketTransport(
  url: string,
  onClose: (code: number, reason: string) => void
): Promise<SocketTransport> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    let handlers: ((message: string) => void)[] = [];
    let opened = false;

    socket.onmessage = (event) => {
      const message = String(event.data);
      handlers.forEach((handler) => handler(message));
    };
    socket.onopen = () => {
      opened = true;
      resolve({
        send: (message) => {
          if (socket.readyState !== WebSocket.OPEN) {
            throw new Error('The language server connection is closed.');
          }
          socket.send(message);
        },
        subscribe: (handler) => {
          handlers.push(handler);
        },
        unsubscribe: (handler) => {
          handlers = handlers.filter((each) => each !== handler);
        },
        close: () => socket.close(),
      });
    };
    socket.onclose = (event) => {
      onClose(event.code, event.reason);
      if (!opened) {
        reject(new Error(event.reason || 'The language server connection could not be opened.'));
      }
    };
  });
}
