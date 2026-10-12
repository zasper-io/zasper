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
