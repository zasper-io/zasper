import { atom } from 'jotai';

import { AgentChat, Mention } from '@/api';

/** Whether the agent panel, on the right of the editor, is open. */
export const agentPanelOpenAtom = atom(false);

/** The chat the panel shows; the server holds the chat itself. */
export const agentChatAtom = atom<AgentChat | null>(null);

/**
 * What the composer's next message will mention. An atom rather than the composer's own state, because a
 * cell's or an output's Add to chat adds to it from the notebook.
 */
export const composerMentionsAtom = atom<Mention[]>([]);

/** A document an agent wrote for the reader, as its tab shows it. */
export interface OpenedAgentDoc {
  /** The agent's name, as the panel shows it. */
  agent: string;
  name: string;
  text: string;
}

/**
 * The documents agents wrote for the reader, by their tab's key, kept current by the agent panel as the
 * agent writes them again. A tab reads its text from here rather than from disk: the agent keeps the file
 * outside the project, where Zasper reads nothing.
 */
export const agentDocsAtom = atom<Record<string, OpenedAgentDoc>>({});

const DOC_TAB = 'agent-doc:';

/** The key of a document's tab: one per chat and file, whatever the agent writes there next. */
export function agentDocTabKey(chatId: string, path: string): string {
  return `${DOC_TAB}${chatId}:${path}`;
}
