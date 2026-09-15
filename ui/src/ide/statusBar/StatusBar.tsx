import React, { useEffect, useCallback } from 'react';

import { useAtom, useAtomValue } from 'jotai';

import './StatusBar.scss';
import { branchNameAtom } from '@/store/git';
import { columnPositionAtom, fileFormatsAtom, linePositionAtom } from '@/store/editorStatus';
import { getCurrentBranch, logApiError } from '@/api';
import { Icon } from '@/ide/icons';
import { useTooltip } from '@/ide/overlays';
import Tooltip from '@/ide/Tooltip';
import { fileTabsAtom, FileTab } from '@/store/tabState';
import EolStatus from './EolStatus';
import IndentStatus from './IndentStatus';
import LanguageStatus from './LanguageStatus';
import ZoomStatus from './ZoomStatus';

/** What the status bar calls the thing in the active tab. */
function describeTab(tab: FileTab | undefined): string {
  if (!tab) {
    return '';
  }
  switch (tab.type) {
    case 'launcher':
      return 'Launcher';
    case 'terminal':
      return 'Terminal';
    case 'help':
      return 'Help';
    case 'settings':
      return 'Settings';
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
  const branchTip = useTooltip();
  const [linePosition] = useAtom(linePositionAtom);
  const [columnPosition] = useAtom(columnPositionAtom);
  const [branchName, setBranchName] = useAtom(branchNameAtom);
  const [fileTabsState] = useAtom(fileTabsAtom);
  const formats = useAtomValue(fileFormatsAtom);

  const FetchBranchData = useCallback(() => {
    getCurrentBranch().then(setBranchName).catch(logApiError('Error fetching current branch:'));
  }, [setBranchName]);

  useEffect(() => {
    FetchBranchData();
  }, [FetchBranchData]);

  // Derived from the active tab rather than pushed into an atom by whoever opened it, so
  // it cannot go stale on a tab that isn't a file.
  const activeTab = Object.values(fileTabsState).find((tab) => tab.active);

  // Cursor position is a property of a text buffer, and only FileEditor sets it — so a terminal or
  // launcher tab shows none of it.
  const isTextEditor = activeTab?.type === 'file';
  // Set once FileEditor has read the file as text: an image or a PDF has no indentation to change.
  const formatPath =
    activeTab?.type === 'file' && formats[activeTab.path] !== undefined ? activeTab.path : null;

  return (
    <div className="statusBar">
      <div className="leftStatus">
        {/* Inert text until now. It is the one place the branch is always visible, so it is where people
            press to change it — the panel it opens is where the branch list lives. */}
        {branchName && (
          <>
            <button
              type="button"
              className="statusItem statusButton"
              onClick={onBranchClick}
              {...branchTip.anchorProps}
            >
              <Icon name="git-branch" /> {branchName}
            </button>
            <Tooltip tip={branchTip} label={`On branch ${branchName} — open source control`} />
          </>
        )}
      </div>
      <div className="rightStatus">
        {isTextEditor && (
          // Tabular figures: these change on every keystroke, and proportional ones make `Col 9`
          // narrower than `Col 10`, which shifts everything to their right.
          <span className="statusItem z-tabular">
            Ln {linePosition}, Col {columnPosition}
          </span>
        )}
        {formatPath !== null && (
          <>
            <IndentStatus path={formatPath} />
            {/* Only UTF-8 text is opened in the editor; anything else is a notice with a Download button. */}
            <span className="statusItem">UTF-8</span>
            <EolStatus path={formatPath} />
          </>
        )}
        {/* A text file says what it is read as, and can be told otherwise. Every other kind of tab says
            what it is, which is not a thing anyone can change. */}
        {formatPath !== null && activeTab !== undefined ? (
          <LanguageStatus path={formatPath} fileName={activeTab.name} />
        ) : (
          <span className="statusItem">{describeTab(activeTab)}</span>
        )}
        {/* Last on the bar: it belongs to the window rather than to whatever is in the tab, so it
            stays put as the items to its left come and go with the kind of tab that is open. */}
        <ZoomStatus />
      </div>
    </div>
  );
}
