import { useEffect, useRef, useState } from 'react';

import type { ChatItem, ChatView } from './chatLog';

/** The agent's words in the turn that has just ended: everything it said after the last message sent. */
function reply(items: ChatItem[]): string {
  const start = items.findLastIndex((item) => item.kind === 'user') + 1;
  return items
    .slice(start)
    .flatMap((item) => (item.kind === 'agent' ? [item.text] : []))
    .join('\n');
}

/**
 * What the chat says aloud, for a polite live region that is always mounted: the agent's reply once
 * its turn is over, a question it is waiting on, and a failure. The transcript was itself the live
 * region, so a reply was read out a few tokens at a time as it streamed, and read again whenever a
 * tool call redrew the list.
 */
export function useChatAnnouncer(view: ChatView): string {
  const [message, setMessage] = useState('');
  const wasAnswering = useRef(view.answering);
  const seen = useRef(view.items.length);

  useEffect(() => {
    const arrived = view.items.slice(seen.current);
    seen.current = view.items.length;
    const news: string[] = [];
    for (const item of arrived) {
      if (item.kind === 'permission' && item.answer === undefined && item.auto !== true) {
        news.push(`The agent asks: ${item.title}`);
      } else if (item.kind === 'note' && item.failed) {
        news.push(item.text);
      }
    }
    if (wasAnswering.current && !view.answering) {
      const text = reply(view.items);
      if (text !== '') {
        news.push(text);
      }
    }
    wasAnswering.current = view.answering;
    if (news.length > 0) {
      const text = news.join('\n');
      setMessage((previous) => (previous === text ? `${text} ` : text));
    }
  }, [view]);

  return message;
}
