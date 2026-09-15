import { useAtomValue } from 'jotai';
import React from 'react';
import { toast } from 'react-toastify';
import { diskComparePath } from '@/store/diskChanges';
import { searchPreviewPath } from '@/store/projectSearch';
import { closedTabsAtom } from '@/store/tabActions';
import { activeTabPathAtom, fileTabsAtom, FileTab } from '@/store/tabState';
import { useTabActions } from '@/store/tabActions';
import { unsavedTabsAtom } from '@/store/unsavedState';
import './TabIndex.scss';
import { apiErrorMessage } from '@/api';
import { copyToClipboard } from '@/browser';
import { formatChord } from '@/commands/keys';
import { useRegisterCommands } from '@/commands/registry';
import { Command } from '@/commands/types';
import { FileMark, Icon } from '@/ide/icons';
import { useTooltip } from '@/ide/overlays';
import ContextMenu from '@/ide/sidebar/contextMenu/ContextMenu';
import { useRevealInTree } from '@/ide/sidebar/fileBrowser/useRevealInTree';
import Tooltip from '@/ide/Tooltip';
import {
  CLOSE_COMMANDS,
  CloseScope,
  keepsTarget,
  TAB_COMMANDS,
  tabFilePath,
  tabsToClose,
} from './tabCommands';
import UnsavedChangesDialog from './UnsavedChangesDialog';

/**
 * What a tab wears in front of its name.
 *
 * Only a file gets a file-type mark; the other kinds of tab are not files, and a launcher
 * keeps the product logo because that is what it is.
 */
function TabMark({ tab }: { tab: FileTab }) {
  if (tab.type === 'launcher') {
    return <img className="tabIcon" src="./images/logo-icon.svg" alt="" />;
  }
  if (tab.type === 'terminal') {
    return <Icon name="terminal" className="tabIcon" />;
  }
  if (tab.type === 'help') {
    return <Icon name="circle-help" className="tabIcon" />;
  }
  if (tab.type === 'settings') {
    return <Icon name="settings" className="tabIcon" />;
  }
  if (tab.type === 'lsp-log') {
    return <Icon name="terminal" className="tabIcon" />;
  }
  // The file's own name for a diff: its tab is named `notes.txt (diff)`, whose extension is
  // `txt (diff)` and which would therefore get the mark for an unknown type.
  const file =
    tab.type === 'disk-diff'
      ? diskComparePath(tab.path)
      : tab.type === 'search-preview'
        ? searchPreviewPath(tab.path)
        : (tab.diff?.path ?? tab.name);
  return <FileMark name={file} className="tabIcon" />;
}

interface TabIndexProps {
  /** Brings the file explorer into view, for Reveal in File Explorer. */
  onShowFileBrowser: () => void;
}

interface PendingClose {
  /** The unsaved tabs the prompt is asking about, in strip order. */
  keys: string[];
  /** The tab to bring to the front if the front tab goes; see `keepsTarget`. */
  focus?: string;
}

export default function TabIndex({ onShowFileBrowser }: TabIndexProps) {
  const fileTabsState = useAtomValue(fileTabsAtom);
  const activePath = useAtomValue(activeTabPathAtom);
  const { activateTab, closeTabs, reopenClosedTab } = useTabActions();
  const closedTabs = useAtomValue(closedTabsAtom);
  const unsavedTabs = useAtomValue(unsavedTabsAtom);
  const revealInTree = useRevealInTree();
  const [pendingClose, setPendingClose] = React.useState<PendingClose | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState('');
  const [menu, setMenu] = React.useState<{ key: string; xPos: number; yPos: number } | null>(null);

  // Tabs with nothing unsaved close at once. The unsaved ones are asked about in one prompt, however
  // many there are: discarding the work has to be an answer, not a side effect of the click.
  const requestClose = (keys: string[], focus?: string) => {
    const unsaved = keys.filter((key) => unsavedTabs[key] !== undefined);
    closeTabs(
      keys.filter((key) => unsavedTabs[key] === undefined),
      focus
    );
    if (unsaved.length > 0) {
      setPendingClose({ keys: unsaved, focus });
      setSaveError('');
    }
  };

  const closeScope = (scope: CloseScope, target: string) =>
    requestClose(
      tabsToClose(fileTabsState, target, scope, unsavedTabs),
      keepsTarget(scope) ? target : undefined
    );

  const saveAndClose = async () => {
    if (!pendingClose) {
      return;
    }
    const { keys, focus } = pendingClose;
    setSaving(true);
    setSaveError('');
    const saved: string[] = [];
    try {
      for (const key of keys) {
        await unsavedTabs[key]();
        saved.push(key);
      }
    } catch (error: unknown) {
      // Left open on the reason the server gave, over the files still unsaved: their editors hold
      // the only copy of the work. What did save closes, as asked.
      closeTabs(saved, focus);
      setPendingClose({ keys: keys.filter((key) => !saved.includes(key)), focus });
      setSaveError(apiErrorMessage(error));
      setSaving(false);
      return;
    }
    setSaving(false);
    setPendingClose(null);
    closeTabs(keys, focus);
  };

  const discardAndClose = () => {
    if (!pendingClose) {
      return;
    }
    setPendingClose(null);
    closeTabs(pendingClose.keys, pendingClose.focus);
  };

  const copyPath = async (path: string) => {
    if (!(await copyToClipboard(path))) {
      // The Clipboard API is only there over HTTPS or on localhost.
      toast.error('The browser would not allow writing to the clipboard.');
    }
  };

  const reveal = (path: string) => {
    onShowFileBrowser();
    void revealInTree(path);
  };

  const pathOf = (key: string): string | null => {
    const tab = fileTabsState[key];
    return tab === undefined ? null : tabFilePath(tab);
  };

  // A close while the prompt is up would replace the question being answered.
  const commands: Command[] = [
    ...CLOSE_COMMANDS.map(({ id, scope }) => ({
      ...TAB_COMMANDS[id],
      isEnabled: () =>
        pendingClose === null &&
        tabsToClose(fileTabsState, activePath, scope, unsavedTabs).length > 0,
      execute: () => closeScope(scope, activePath),
    })),
    {
      ...TAB_COMMANDS['tab:reopen'],
      isEnabled: () => closedTabs.length > 0,
      execute: reopenClosedTab,
    },
    {
      ...TAB_COMMANDS['tab:copy-path'],
      isEnabled: () => pathOf(activePath) !== null,
      execute: () => {
        const path = pathOf(activePath);
        if (path !== null) {
          void copyPath(path);
        }
      },
    },
    {
      ...TAB_COMMANDS['tab:reveal'],
      isEnabled: () => pathOf(activePath) !== null,
      execute: () => {
        const path = pathOf(activePath);
        if (path !== null) {
          reveal(path);
        }
      },
    },
  ];
  useRegisterCommands(commands);

  const menuItems = (key: string) => {
    const closes = CLOSE_COMMANDS.map(({ id, scope }) => {
      const { label, keys } = TAB_COMMANDS[id];
      return {
        label,
        keys: keys === undefined ? undefined : formatChord(keys[0]),
        disabled: tabsToClose(fileTabsState, key, scope, unsavedTabs).length === 0,
        action: () => closeScope(scope, key),
      };
    });
    const path = pathOf(key);
    // Left out rather than greyed on a tab with no file: nothing about a terminal could enable them.
    if (path === null) {
      return closes;
    }
    return [
      ...closes,
      {
        label: TAB_COMMANDS['tab:copy-path'].label,
        separated: true,
        action: () => void copyPath(path),
      },
      { label: TAB_COMMANDS['tab:reveal'].label, action: () => reveal(path) },
    ];
  };

  return (
    <div className="tabHeader">
      <ul className="tabList">
        {Object.keys(fileTabsState).map((key) => (
          // Keyed by path, as the tab content is: by index, closing a tab moves every tab after it
          // into the DOM node of its neighbour.
          <Tab
            key={key}
            tab={fileTabsState[key]}
            isDirty={unsavedTabs[key] !== undefined}
            onActivate={() => activateTab(key)}
            onClose={(event) => {
              event.stopPropagation();
              requestClose([key]);
            }}
            onMenu={(xPos, yPos) => setMenu({ key, xPos, yPos })}
          />
        ))}
      </ul>
      {menu && fileTabsState[menu.key] !== undefined && (
        <ContextMenu
          xPos={menu.xPos}
          yPos={menu.yPos}
          items={menuItems(menu.key)}
          onClose={() => setMenu(null)}
        />
      )}
      {pendingClose && (
        <UnsavedChangesDialog
          names={pendingClose.keys.map((key) => fileTabsState[key]?.name ?? key)}
          saving={saving}
          error={saveError}
          onSave={saveAndClose}
          onDiscard={discardAndClose}
          onCancel={() => setPendingClose(null)}
        />
      )}
    </div>
  );
}

interface TabProps {
  tab: FileTab;
  isDirty: boolean;
  onActivate: () => void;
  onClose: (event: React.MouseEvent) => void;
  /** Opens the tab menu at a point in client coordinates. */
  onMenu: (xPos: number, yPos: number) => void;
}

/**
 * One tab on the strip.
 *
 * The tooltip is the whole of what the tab cannot show: `.tabName` truncates with an ellipsis, so two
 * notebooks with a long shared prefix were the same tab, and the path rather than the name is what
 * tells two `main.py` apart. Whether it is unsaved goes on a second line rather than on the dot: the
 * dot is inside the tab, so a tooltip of its own would open on top of this one.
 */
function Tab({ tab, isDirty, onActivate, onClose, onMenu }: TabProps) {
  const tip = useTooltip();
  // A path names a file; the Launcher's, Help's and Settings' keys are not paths.
  const label = [
    tab.type === 'launcher' ||
    tab.type === 'help' ||
    tab.type === 'settings' ||
    tab.type === 'lsp-log'
      ? tab.name
      : tab.type === 'disk-diff'
        ? diskComparePath(tab.path)
        : tab.type === 'search-preview'
          ? searchPreviewPath(tab.path)
          : tab.path,
  ];
  if (isDirty) {
    label.push('Unsaved changes');
  }

  const handleContextMenu = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    // Shift-F10 and the menu key raise this with no pointer to open at, so the menu goes under the tab.
    if (event.clientX === 0 && event.clientY === 0) {
      const box = event.currentTarget.getBoundingClientRect();
      onMenu(box.left, box.bottom + 2);
    } else {
      onMenu(event.clientX, event.clientY);
    }
  };

  return (
    <li className="tab-item" role="presentation">
      <button
        type="button"
        className={tab.active ? 'tab is-active' : 'tab'}
        onClick={onActivate}
        onContextMenu={handleContextMenu}
        aria-haspopup="menu"
        {...tip.anchorProps}
      >
        <TabMark tab={tab} />
        {/* The name is an element of its own so that the mark's lettering is not part of it:
            a bare text node makes the tab read as `txtnotes.txt` to anything matching on
            text, and `.panel-row-name` in the sidebar's rows is the same idea. */}
        <span className="tabName">{tab.name}</span>
        {/* Unsaved, said as a dot rather than in the name: the name is already fighting an
            ellipsis for room, and until now nothing on the strip said it at all — the first a
            tab told anyone was the dialog that opens when it is closed. */}
        {isDirty && <span className="tab-dirty" role="img" aria-label="Unsaved changes" />}
        {tab.name !== 'Launcher' && (
          // The handler is on the span rather than on the icon: an <Icon> is a glyph and
          // takes no events, and a <button> cannot be nested in the tab's own button. Its name is
          // `aria-label` and not a tooltip for the same reason the dot's is.
          <span
            className="z-icon-button on-chrome tab-close"
            role="button"
            aria-label="Close"
            onClick={onClose}
          >
            <Icon name="x" size={12} />
          </span>
        )}
      </button>
      <Tooltip tip={tip} label={label} />
    </li>
  );
}
