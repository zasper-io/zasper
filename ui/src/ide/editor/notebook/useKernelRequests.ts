import { useCallback, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';

import { Session } from '@/api';

import {
  buildCompleteRequest,
  buildExecuteRequest,
  buildInputReply,
  buildInspectRequest,
  CompleteReply,
  InspectReply,
  KernelMessage,
} from './kernelMessages';

/**
 * How long to wait for a `complete_reply` or an `inspect_reply` before giving up on it. A kernel handles
 * shell messages one at a time, so a question asked while a cell runs is answered after the editor has
 * moved on.
 */
const REPLY_TIMEOUT_MS = 2000;

/** The shell replies a promise here waits for, rather than the notebook's own message loop. */
const AWAITED_REPLIES = new Set(['complete_reply', 'inspect_reply']);

/**
 * The requests a notebook sends its kernel, and what routes the replies back: which cell each
 * execute_request ran, and which completion each complete_reply answers.
 */
export function useKernelRequests(
  session: Session | null | undefined,
  connection: WebSocket,
  userName: string
) {
  // Keyed by the request's msg_id, which is what a reply's parent_header carries.
  const pendingReplies = useRef(new Map<string, (reply: unknown) => void>());
  /*
   * Which cell each execute_request was sent for, keyed by its msg_id. The cell id cannot be the msg_id:
   * a cell runs many times, and one id for every run makes a previous run's output indistinguishable
   * from this one's.
   */
  const executingCells = useRef(new Map<string, string>());
  // The same cells as state, so a cell can draw a spinner for as long as it runs: a ref write is not a
  // render.
  const [runningCellIds, setRunningCellIds] = useState<ReadonlySet<string>>(new Set());

  const syncRunningCells = useCallback(() => {
    setRunningCellIds(new Set(executingCells.current.values()));
  }, []);

  /** The cell a message answers, when it answers an execute_request sent from here. */
  const cellFor = useCallback((message: KernelMessage): string | undefined => {
    const requestId: string | undefined = message.parent_header?.msg_id;
    return requestId ? executingCells.current.get(requestId) : undefined;
  }, []);

  /** Settles what a message finishes: the question it answers, or the run the kernel is idle after. */
  const settle = useCallback(
    (message: KernelMessage) => {
      const requestId: string | undefined = message.parent_header?.msg_id;
      if (AWAITED_REPLIES.has(message.header.msg_type) && requestId) {
        pendingReplies.current.get(requestId)?.(message.content);
      }
      // Idle means the kernel has finished with the request and will send nothing further for it.
      if (
        message.header.msg_type === 'status' &&
        message.content.execution_state === 'idle' &&
        requestId
      ) {
        executingCells.current.delete(requestId);
        syncRunningCells();
      }
    },
    [syncRunningCells]
  );

  /** Forgets every run, for a restart: nothing the old kernel was running will ever report back. */
  const forgetRunningCells = useCallback(() => {
    executingCells.current.clear();
    syncRunningCells();
  }, [syncRunningCells]);

  const sendExecuteRequest = useCallback(
    (source: string, cellId: string) => {
      if (session && connection && connection.readyState === WebSocket.OPEN) {
        const msgId = uuidv4();
        executingCells.current.set(msgId, cellId);
        try {
          connection.send(buildExecuteRequest(session.id, userName, msgId, cellId, source));
        } catch (error) {
          executingCells.current.delete(msgId);
          console.error('Failed to send execute_request message:', error);
        }
        syncRunningCells();
      }
    },
    [session, connection, userName, syncRunningCells]
  );

  const sendInputReply = useCallback(
    (parentHeader: KernelMessage, inputValue: string) => {
      if (session) {
        connection.send(buildInputReply(session.id, userName, uuidv4(), parentHeader, inputValue));
      }
    },
    [session, connection, userName]
  );

  /**
   * Sends one shell request and resolves with its reply's content, or null when there is no live kernel
   * to ask or nothing arrives in time. A promise per request rather than state, because two keystrokes
   * can have requests in flight at once and only the newer answer is wanted.
   */
  const askKernel = useCallback(
    <Reply>(build: (sessionId: string, msgId: string) => string): Promise<Reply | null> => {
      if (!session || !connection || connection.readyState !== WebSocket.OPEN) {
        return Promise.resolve(null);
      }

      const msgId = uuidv4();

      return new Promise((resolve) => {
        const timer = window.setTimeout(() => {
          pendingReplies.current.delete(msgId);
          resolve(null);
        }, REPLY_TIMEOUT_MS);

        pendingReplies.current.set(msgId, (reply) => {
          window.clearTimeout(timer);
          pendingReplies.current.delete(msgId);
          resolve(reply as Reply);
        });

        try {
          connection.send(build(session.id, msgId));
        } catch (error) {
          console.error('Failed to send a request to the kernel:', error);
          window.clearTimeout(timer);
          pendingReplies.current.delete(msgId);
          resolve(null);
        }
      });
    },
    [session, connection]
  );

  /** Asks the kernel what completes at `cursorPos` in `source`. */
  const requestCompletions = useCallback(
    (source: string, cursorPos: number): Promise<CompleteReply | null> =>
      askKernel<CompleteReply>((sessionId, msgId) =>
        buildCompleteRequest(sessionId, userName, msgId, source, cursorPos)
      ),
    [askKernel, userName]
  );

  /** Asks the kernel about the name at `cursorPos` in `source` — Jupyter's Shift+Tab. */
  const requestInspection = useCallback(
    (source: string, cursorPos: number, detailLevel: 0 | 1 = 0): Promise<InspectReply | null> =>
      askKernel<InspectReply>((sessionId, msgId) =>
        buildInspectRequest(sessionId, userName, msgId, source, cursorPos, detailLevel)
      ),
    [askKernel, userName]
  );

  return {
    runningCellIds,
    cellFor,
    settle,
    forgetRunningCells,
    sendExecuteRequest,
    sendInputReply,
    requestCompletions,
    requestInspection,
  };
}
