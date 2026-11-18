import { lazy, Suspense } from 'react';
import { useAtomValue } from 'jotai';

import { useFollowLink } from '@/ide/agents/links';
import { Icon } from '@/ide/icons';
import { agentDocsAtom } from '@/store/agents';
import { FileTab } from '@/store/tabState';
import './AgentDocTab.scss';

const MarkdownRenderer = lazy(() => import('./notebook/MarkdownRenderer'));

/**
 * A document an agent wrote for the reader, such as Antigravity's plan, as a Markdown file's preview. It
 * is read-only: the file is the agent's, and the reader changes it by replying in the chat.
 */
export default function AgentDocTab({ data }: { data: FileTab }) {
  const doc = useAtomValue(agentDocsAtom)[data.path];
  // Its own links are the agent's too: a file in the project opens, a web page leaves for a new tab.
  const followLink = useFollowLink();
  if (doc === undefined) {
    return (
      <div className="agentDocTab">
        <p className="agentDocTab-gone">
          This document is no longer in a chat. Open it again from the agent panel.
        </p>
      </div>
    );
  }
  return (
    <div className="agentDocTab">
      <div className="z-notice" role="note">
        <Icon name="info" size={14} />
        <p>
          {doc.agent}&rsquo;s {doc.name}, read-only. To change it, reply in the chat; {doc.agent}{' '}
          writes it again.
        </p>
      </div>
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- the links inside are what is pressed, and Enter on one is a click that reaches here */}
      <div className="agentDocTab-body" onClick={followLink}>
        <Suspense fallback={<pre>{doc.text}</pre>}>
          <MarkdownRenderer source={doc.text} singleDollarMath={false} fileLinks />
        </Suspense>
      </div>
    </div>
  );
}
