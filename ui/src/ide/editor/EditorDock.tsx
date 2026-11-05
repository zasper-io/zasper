import React, { useMemo } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';

import { Icon } from '@/ide/icons';
import IconButton from '@/ide/IconButton';
import { DockTab, dockOpenAtom, dockTabAtom, problemsAtom } from '@/store/languageServers';
import { referencesAtom } from '@/store/references';
import { terminalsAtom } from '@/store/terminals';
import { useTabActions } from '@/store/tabActions';
import ProblemsPanel from './ProblemsPanel';
import ReferencesList from './ReferencesList';
import TerminalPanel from '@/ide/terminal/TerminalPanel';
import VariablesPanel from '@/ide/variables/VariablesPanel';
import { variablesReloadAtom } from '@/store/variables';
import './EditorDock.scss';

/**
 * The panel under the editor, which holds more than problems: the head is tabs,
 * and each answer opens its own. The width of the editor is the point — a message, or a line of code with
 * the place it is in, fits on one row here and does not in the sidebar.
 */
export default function EditorDock({ hidden = false }: { hidden?: boolean }) {
  const [tab, setTab] = useAtom(dockTabAtom);
  const [, setOpen] = useAtom(dockOpenAtom);
  const problems = useAtomValue(problemsAtom);
  const references = useAtomValue(referencesAtom);
  const terminals = useAtomValue(terminalsAtom);
  const { openTerminal } = useTabActions();
  const reloadVariables = useSetAtom(variablesReloadAtom);

  const problemCount = useMemo(
    () => Object.values(problems).reduce((count, list) => count + list.length, 0),
    [problems]
  );

  const tabs: {
    id: DockTab;
    label: string;
    icon: 'list-checks' | 'text-quote' | 'terminal' | 'variable';
    count?: number;
  }[] = [
    { id: 'problems', label: 'Problems', icon: 'list-checks', count: problemCount },
    {
      id: 'references',
      label: 'References',
      icon: 'text-quote',
      count: references?.state === 'answered' ? references.total : undefined,
    },
    { id: 'variables', label: 'Variables', icon: 'variable' },
    {
      id: 'terminal',
      label: 'Terminals',
      icon: 'terminal',
      count: Object.keys(terminals).length || undefined,
    },
  ];

  const onTabKey = (event: React.KeyboardEvent) => {
    const at = tabs.findIndex((each) => each.id === tab);
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) {
      return;
    }
    event.preventDefault();
    const next = tabs[(at + step + tabs.length) % tabs.length].id;
    setTab(next);
    document.getElementById(`dock-tab-${next}`)?.focus();
  };

  return (
    <section
      className="editorDock"
      data-region="dock"
      aria-label="Problems, references, variables and terminals"
      hidden={hidden}
    >
      <div className="editorDock-head">
        {/* As the editor's tab strip: one Tab stop, and Left and Right go along it. They bring the
            tab forward as they go, since a list is cheap to show. */}
        <div className="editorDock-tabs" role="tablist" aria-label="Panel" onKeyDown={onTabKey}>
          {tabs.map((each) => (
            <button
              key={each.id}
              type="button"
              role="tab"
              id={`dock-tab-${each.id}`}
              aria-selected={tab === each.id}
              aria-controls={`dock-panel-${each.id}`}
              tabIndex={tab === each.id ? 0 : -1}
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
        {tab === 'variables' && (
          <IconButton
            icon="refresh-cw"
            label="Refresh variables"
            onClick={() => reloadVariables((count) => count + 1)}
          />
        )}
        <IconButton icon="x" label="Close panel" onClick={() => setOpen(false)} />
      </div>
      {tab === 'problems' && (
        <DockPane id="problems">
          <ProblemsPanel />
        </DockPane>
      )}
      {tab === 'references' && (
        <DockPane id="references">
          <ReferencesList />
        </DockPane>
      )}
      {tab === 'variables' && (
        <DockPane id="variables">
          <VariablesPanel />
        </DockPane>
      )}
      {/* Mounted whatever the panel is showing, and hidden rather than unmounted: a shell's life is its
          websocket, so switching to Problems and back would have handed you a new shell wearing the old
          one's name. `hidden`, not `display: none` on the pane, because xterm measures the element it is
          in and one with no layout box answers 100 pixels. */}
      {(tab === 'terminal' || Object.keys(terminals).length > 0) && (
        <DockPane id="terminal" hidden={tab !== 'terminal'}>
          <TerminalPanel hidden={tab !== 'terminal'} />
        </DockPane>
      )}
    </section>
  );
}

/** The tab panel a dock tab controls. */
function DockPane(props: { id: DockTab; hidden?: boolean; children: React.ReactNode }) {
  return (
    <div
      className="editorDock-pane"
      role="tabpanel"
      id={`dock-panel-${props.id}`}
      aria-labelledby={`dock-tab-${props.id}`}
      hidden={props.hidden}
    >
      {props.children}
    </div>
  );
}
