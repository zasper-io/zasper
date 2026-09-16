import React, { useMemo } from 'react';
import { useAtom, useAtomValue } from 'jotai';

import { Icon } from '@/ide/icons';
import IconButton from '@/ide/IconButton';
import { DockTab, dockOpenAtom, dockTabAtom, problemsAtom } from '@/store/languageServers';
import { referencesAtom } from '@/store/references';
import ProblemsPanel from './ProblemsPanel';
import ReferencesList from './ReferencesList';
import './EditorDock.scss';

/**
 * The panel under the editor (story 19), which holds more than problems since story 20: the head is tabs,
 * and each answer opens its own. The width of the editor is the point — a message, or a line of code with
 * the place it is in, fits on one row here and does not in the sidebar.
 */
export default function EditorDock() {
  const [tab, setTab] = useAtom(dockTabAtom);
  const [, setOpen] = useAtom(dockOpenAtom);
  const problems = useAtomValue(problemsAtom);
  const references = useAtomValue(referencesAtom);

  const problemCount = useMemo(
    () => Object.values(problems).reduce((count, list) => count + list.length, 0),
    [problems]
  );

  const tabs: { id: DockTab; label: string; icon: 'list-checks' | 'text-quote'; count?: number }[] =
    [
      { id: 'problems', label: 'Problems', icon: 'list-checks', count: problemCount },
      {
        id: 'references',
        label: 'References',
        icon: 'text-quote',
        count: references?.state === 'answered' ? references.total : undefined,
      },
    ];

  return (
    <section className="editorDock" aria-label="Problems and references">
      <div className="editorDock-head">
        <div className="editorDock-tabs" role="tablist" aria-label="Panel">
          {tabs.map((each) => (
            <button
              key={each.id}
              type="button"
              role="tab"
              aria-selected={tab === each.id}
              className={tab === each.id ? 'editorDock-tab is-current' : 'editorDock-tab'}
              onClick={() => setTab(each.id)}
            >
              <Icon name={each.icon} size={12} />
              {each.label}
              {each.count !== undefined && (
                <span className="panel-section-count">{each.count}</span>
              )}
            </button>
          ))}
        </div>
        <IconButton icon="x" label="Close panel" onClick={() => setOpen(false)} />
      </div>
      {tab === 'problems' ? <ProblemsPanel /> : <ReferencesList />}
    </section>
  );
}
