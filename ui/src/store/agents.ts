import { atom } from 'jotai';

import { AgentChat } from '@/api';

/** Whether the agent panel, on the right of the editor, is open. */
export const agentPanelOpenAtom = atom(false);

/** The chat the panel shows; the server holds the chat itself. */
export const agentChatAtom = atom<AgentChat | null>(null);
