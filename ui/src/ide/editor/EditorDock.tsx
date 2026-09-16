import React, { useMemo } from 'react';
import { useAtom, useAtomValue } from 'jotai';

import { Icon } from '@/ide/icons';
import IconButton from '@/ide/IconButton';
import { DockTab, dockOpenAtom, dockTabAtom, problemsAtom } from '@/store/languageServers';
import { referencesAtom } from '@/store/references';
import { terminalsAtom } from '@/store/terminals';
import { useTabActions } from '@/store/tabActions';
import ProblemsPanel from './ProblemsPanel';
import ReferencesList from './ReferencesList';
import TerminalPanel from '@/ide/terminal/TerminalPanel';
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
  const terminals = useAtomValue(terminalsAtom);
  const { openTerminal } = useTabActions();

  const problemCount = useMemo(
    () => Object.values(problems).reduce((count, list) => count + list.length, 0),
    [problems]
  );

  const tabs: {
    id: DockTab;
    label: string;
    icon: 'list-checks' | 'text-quote' | 'terminal';
    count?: number;
  }[] = [
    { id: 'problems', label: 'Problems', icon: 'list-checks', count: problemCount },
    {
      id: 'references',
      label: 'References',
      icon: 'text-quote',
      count: references?.state === 'answered' ? references.total : undefined,
    },
    {
      id: 'terminal',
      label: 'Terminal',
      icon: 'terminal',
      count: Object.keys(terminals).length || undefined,
    },
  ];

  return (
    <section className="editorDock" aria-label="Problems, references and terminals">
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
        {/* Another shell, where the tab strip's own new tab used to be. */}
        {tab === 'terminal' && (
          <IconButton icon="plus" label="New terminal" onClick={() => openTerminal()} />
        )}
        <IconButton icon="x" label="Close panel" onClick={() => setOpen(false)} />
      </div>
      {tab === 'problems' && <ProblemsPanel />}
      {tab === 'references' && <ReferencesList />}
      {/* Mounted whatever the panel is showing, and hidden rather than unmounted: a shell's life is its
          websocket, so switching to Problems and back would have handed you a new shell wearing the old
          one's name. `hidden`, not `display: none` on the pane, because xterm measures the element it is
          in and one with no layout box answers 100 pixels. */}
      {(tab === 'terminal' || Object.keys(terminals).length > 0) && (
        <TerminalPanel hidden={tab !== 'terminal'} />
      )}
    </section>
  );
}
