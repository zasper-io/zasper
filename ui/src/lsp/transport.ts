import { Transport } from '@codemirror/lsp-client';

/** Why the server closed the socket, by the close codes internal/lsp sends. */
export const CLOSE_TURNED_OFF = 4001;
export const CLOSE_NOT_INSTALLED = 4002;
export const CLOSE_EXITED = 4003;

export interface SocketTransport extends Transport {
  close: () => void;
  /**
   * Takes a message before the client sees it, and keeps it if it returns true.
   *
   * There is one thing this is for: a request *from* the server, which the client answers with "method
   * not implemented" — so `workspace/applyEdit` has to be caught and answered here, before it gets that
   * far, or the server would hear a refusal and a reply to the same id.
   */
  intercept: (handler: (message: string) => boolean) => void;
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
    const interceptors: ((message: string) => boolean)[] = [];
    let opened = false;

    socket.onmessage = (event) => {
      const message = String(event.data);
      if (interceptors.some((interceptor) => interceptor(message))) {
        return;
      }
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
        intercept: (handler) => {
          interceptors.push(handler);
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
