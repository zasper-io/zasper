import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ChatEvent, Mention, websocketUrl } from '@/api';
import { ChatView, foldChat } from './chatLog';

const RETRY_MS = 1000;

/**
 * A chat's socket and what its log adds up to. The server sends the whole log on every connection, so
 * a reconnect starts the log again rather than adding to it, and a reload draws the same chat.
 */
export function useAgentChat(chatId: string | null) {
  const [events, setEvents] = useState<ChatEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const socket = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (chatId === null) {
      setEvents([]);
      return;
    }
    let closed = false;
    let retry: number | undefined;

    const connect = () => {
      const current = new WebSocket(websocketUrl(`/ws/agents/chats/${encodeURIComponent(chatId)}`));
      socket.current = current;
      current.onopen = () => {
        setEvents([]);
        setConnected(true);
      };
      current.onmessage = (message) => {
        const event = JSON.parse(String(message.data)) as ChatEvent;
        setEvents((previous) => [...previous, event]);
      };
      current.onclose = () => {
        setConnected(false);
        if (!closed) {
          retry = window.setTimeout(connect, RETRY_MS);
        }
      };
    };
    connect();

    return () => {
      closed = true;
      window.clearTimeout(retry);
      socket.current?.close();
      socket.current = null;
    };
  }, [chatId]);

  const send = useCallback((message: Record<string, unknown>) => {
    if (socket.current?.readyState === WebSocket.OPEN) {
      socket.current.send(JSON.stringify(message));
    }
  }, []);

  const view: ChatView = useMemo(() => foldChat(events), [events]);

  return {
    view,
    connected,
    prompt: useCallback(
      (text: string, mentions: Mention[] = []) => send({ type: 'prompt', text, mentions }),
      [send]
    ),
    cancel: useCallback(() => send({ type: 'cancel' }), [send]),
    answer: useCallback(
      (id: string, optionId: string) => send({ type: 'answer', id, option_id: optionId }),
      [send]
    ),
    setMode: useCallback((mode: string) => send({ type: 'mode', mode }), [send]),
  };
}
