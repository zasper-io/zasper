import React, { useEffect, useCallback } from 'react';

import { useAtom } from 'jotai';

import './StatusBar.scss';
import {
  branchNameAtom,
  columnPositionAtom,
  encodingAtom,
  eolSequenceAtom,
  indentationModeAtom,
  indentationSizeAtom,
  linePositionAtom,
} from '@/store/AppState';
import { getCurrentBranch, logApiError } from '@/api';
import { fileTabsAtom, IfileTab } from '@/store/TabState';

/** What the status bar calls the thing in the active tab. */
function describeTab(tab: IfileTab | undefined): string {
  if (!tab) {
    return '';
  }
  switch (tab.type) {
    case 'launcher':
      return 'Launcher';
    case 'terminal':
      return 'Terminal';
    case 'notebook':
      return 'Notebook';
    default:
      return tab.extension ?? 'Plain Text';
  }
}

interface StatusBarProps {
  /** Opens the source control panel, where the branch can actually be changed. */
  onBranchClick: () => void;
}

export default function StatusBar({ onBranchClick }: StatusBarProps) {
  const [indentationMode] = useAtom(indentationModeAtom);
  const [indentationSize] = useAtom(indentationSizeAtom);
  const [linePosition] = useAtom(linePositionAtom);
  const [columnPosition] = useAtom(columnPositionAtom);
  const [encoding] = useAtom(encodingAtom);
  const [eolSequence] = useAtom(eolSequenceAtom);
  const [branchName, setBranchName] = useAtom(branchNameAtom);
  const [fileTabsState] = useAtom(fileTabsAtom);

  const FetchBranchData = useCallback(() => {
    getCurrentBranch().then(setBranchName).catch(logApiError('Error fetching current branch:'));
  }, [setBranchName]);

  useEffect(() => {
    FetchBranchData();
  }, [FetchBranchData]);

  // Derived from the active tab rather than pushed into an atom by whoever opened it, so
  // it cannot go stale on a tab that isn't a file.
  const activeTab = Object.values(fileTabsState).find((tab) => tab.active);

  // Cursor position, indentation, encoding and line endings are properties of a text buffer,
  // and only FileEditor sets them — so a terminal or launcher tab shows none of them.
  const isTextEditor = activeTab?.type === 'file';

  return (
    <div className="statusBar">
      <div className="leftStatus">
        {/* Inert text until now. It is the one place the branch is always visible, so it is where people
            press to change it — the panel it opens is where the branch list lives. */}
        {branchName && (
          <button
            type="button"
            className="statusItem statusButton"
            title={`On branch ${branchName} — open source control`}
            onClick={onBranchClick}
          >
            <i className="fas fa-code-branch"></i> {branchName}
          </button>
        )}
      </div>
      <div className="rightStatus">
        {isTextEditor && (
          <>
            <span className="statusItem">
              Ln {linePosition}, Col {columnPosition}
            </span>
            <span className="statusItem">
              {indentationMode}: {indentationSize}
            </span>
            <span className="statusItem">{encoding}</span>
            <span className="statusItem">{eolSequence}</span>
          </>
        )}
        <span className="statusItem">{describeTab(activeTab)}</span>
      </div>
    </div>
  );
}
