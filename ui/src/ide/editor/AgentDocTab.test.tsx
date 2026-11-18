import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { agentDocsAtom, agentDocTabKey } from '@/store/agents';
import { FileTab } from '@/store/tabState';
import { Provider } from '@/testing/Provider';
import AgentDocTab from './AgentDocTab';

vi.mock('./notebook/MarkdownRenderer', () => ({
  default: ({ source }: { source: string }) => <p>{source}</p>,
}));

const key = agentDocTabKey('chat-1', '/home/u/.gemini/brain/s/plan.md');
const tab = { path: key, name: 'plan.md', type: 'agent-doc' } as FileTab;

describe('AgentDocTab', () => {
  it('shows the agent’s document under a band that says it is read-only', async () => {
    render(
      <Provider
        initialValues={[
          [agentDocsAtom, { [key]: { agent: 'Antigravity CLI', name: 'plan.md', text: '# Plan' } }],
        ]}
      >
        <AgentDocTab data={tab} />
      </Provider>
    );

    expect(screen.getByRole('note')).toHaveTextContent(
      'Antigravity CLI’s plan.md, read-only. To change it, reply in the chat; Antigravity CLI writes it again.'
    );
    // The fallback's <pre> first, then the rendered document.
    expect(await screen.findByText('# Plan', { selector: 'p' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('says so when the chat that wrote it is gone', () => {
    render(
      <Provider>
        <AgentDocTab data={tab} />
      </Provider>
    );

    expect(screen.getByText(/no longer in a chat/)).toBeInTheDocument();
  });
});
