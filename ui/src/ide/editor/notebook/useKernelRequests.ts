import { useCallback, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';

import { Session } from '@/api';

import {
  buildCompleteRequest,
  buildExecuteRequest,
  buildInputReply,
  CompleteReply,
  KernelMessage,
} from './kernelMessages';

/**
 * How long to wait for a `complete_reply` before giving up on it. A kernel handles shell messages one
 * at a time, so a completion asked for while a cell runs is answered after the editor has moved on.
 */
const COMPLETION_TIMEOUT_MS = 2000;

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
  const pendingCompletions = useRef(new Map<string, (reply: CompleteReply) => void>());
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

  /** Settles what a message finishes: the completion it answers, or the run the kernel is idle after. */
  const settle = useCallback(
    (message: KernelMessage) => {
      const requestId: string | undefined = message.parent_header?.msg_id;
      if (message.header.msg_type === 'complete_reply' && requestId) {
        pendingCompletions.current.get(requestId)?.(message.content);
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
   * Asks the kernel what completes at `cursorPos` in `source`, resolving null when there is no live
   * kernel to ask or nothing arrives in time. A promise per request rather than state, because two
   * keystrokes can have requests in flight at once and only the newer answer is wanted.
   */
  const requestCompletions = useCallback(
    (source: string, cursorPos: number): Promise<CompleteReply | null> => {
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
    runningCellIds,
    cellFor,
    settle,
    forgetRunningCells,
    sendExecuteRequest,
    sendInputReply,
    requestCompletions,
  };
}
