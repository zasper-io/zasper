import { useAtomValue } from 'jotai';
import React from 'react';
import { toast } from 'react-toastify';
import { diskComparePath } from '@/store/diskChanges';
import { searchPreviewPath } from '@/store/projectSearch';
import { closedTabsAtom } from '@/store/tabActions';
import { activeTabPathAtom, fileTabsAtom, FileTab, focusedGroupAtom } from '@/store/tabState';
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
  neighbourTab,
  TAB_COMMANDS,
  tabFilePath,
  tabsToClose,
} from './tabCommands';
import { tabIds } from './tabIds';
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
  if (tab.type === 'help') {
    return <Icon name="circle-help" className="tabIcon" />;
  }
  if (tab.type === 'settings') {
    return <Icon name="settings" className="tabIcon" />;
  }
  if (tab.type === 'whats-new') {
    return <Icon name="scroll-text" className="tabIcon" />;
  }
  if (tab.type === 'lsp-log') {
    return <Icon name="terminal" className="tabIcon" />;
  }
  if (tab.type === 'data-viewer') {
    return <Icon name="table" className="tabIcon" />;
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

/** What a tab being dragged carries, so that a file dragged in from the tree is not taken for one. */
const TAB_DRAG = 'application/x-zasper-tab';

// How near an end of the strip a dragged tab scrolls it, and by how much at each dragover, which the
// browser repeats while the pointer rests.
const DRAG_EDGE = 32;
const DRAG_STEP = 12;

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
  const { activateTab, closeTabs, reopenClosedTab, moveTab } = useTabActions();
  const closedTabs = useAtomValue(closedTabsAtom);
  const unsavedTabs = useAtomValue(unsavedTabsAtom);

  // The window's title names what is in front, as an editor's does: it is the first thing a screen
  // reader says on arriving in the window, and the one place a switcher of windows shows. Unsaved is a
  // dot, as on the tab. With the Launcher in front, or nothing, it is the app's name alone.
  const front = fileTabsState[activePath];
  const frontName = front === undefined || front.type === 'launcher' ? null : front.name;
  const frontDirty = unsavedTabs[activePath] !== undefined;
  React.useEffect(() => {
    document.title =
      frontName === null ? 'Zasper' : `${frontDirty ? '● ' : ''}${frontName} — Zasper`;
  }, [frontName, frontDirty]);
  const revealInTree = useRevealInTree();
  const [pendingClose, setPendingClose] = React.useState<PendingClose | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState('');
  const [menu, setMenu] = React.useState<{ key: string; xPos: number; yPos: number } | null>(null);
  const strip = React.useRef<HTMLDivElement>(null);
  const group = useAtomValue(focusedGroupAtom);
  // Set by a close from the strip itself, so the focus goes to the tab that is in front afterwards
  // rather than to the page: the tab it was on has gone.
  const refocus = React.useRef(false);
  const order = Object.keys(fileTabsState);
  const tabCount = order.length;
  // The tab being dragged, and the one it is over.
  const [drag, setDrag] = React.useState<{ from: string; over: string | null } | null>(null);
  // Bumped by Move Tab Left and Right, whose tab is the one in front and has to stay in view. A drag
  // does not bump it: scrolling back to the front tab would undo where the pointer just put the strip.
  const [moved, setMoved] = React.useState(0);

  // The tab in front is scrolled into view, however it got there: opened at the end of a strip wider than
  // the window, chosen from the palette, or left in front by a close. As little as shows it, and on the
  // strip alone: scrollIntoView would scroll the panes around it too.
  React.useLayoutEffect(() => {
    const header = strip.current;
    const tab = header?.querySelector('.tab.is-active');
    if (!header || !tab) {
      return;
    }
    const view = header.getBoundingClientRect();
    const box = tab.getBoundingClientRect();
    // Whole pixels, rounded out: a tab is fractionally wide, and scrollLeft rounds down, which left the
    // last fraction of a pixel of the tab under the edge.
    if (box.left < view.left) {
      header.scrollLeft -= Math.ceil(view.left - box.left);
    } else if (box.right > view.right) {
      header.scrollLeft += Math.ceil(box.right - view.right);
    }
  }, [activePath, tabCount, moved]);

  React.useEffect(() => {
    if (refocus.current) {
      refocus.current = false;
      strip.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
    }
  }, [tabCount]);

  // Left and Right go along the strip, Home and End to its ends; the focus moves and the tab in front
  // does not, so walking past a notebook does not open it. Enter or Space then brings one forward.
  const moveFocus = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const tabs = [...(strip.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])];
    const at = tabs.indexOf(event.currentTarget);
    const to =
      event.key === 'ArrowRight'
        ? (at + 1) % tabs.length
        : event.key === 'ArrowLeft'
          ? (at - 1 + tabs.length) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : -1;
    if (to !== -1) {
      event.preventDefault();
      tabs[to].focus();
    }
  };

  // A mouse wheel turns up and down, and the strip only goes sideways, so on the strip it scrolls
  // sideways without Shift. A trackpad's sideways swipe is left to the browser. Not onWheel: React's is
  // passive, and the page must not also take the turn.
  React.useEffect(() => {
    const header = strip.current;
    if (!header) {
      return;
    }
    const onWheel = (event: WheelEvent) => {
      if (
        Math.abs(event.deltaY) <= Math.abs(event.deltaX) ||
        header.scrollWidth <= header.clientWidth
      ) {
        return;
      }
      event.preventDefault();
      // Firefox can count a turn in lines rather than pixels.
      header.scrollLeft +=
        event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 16 : event.deltaY;
    };
    header.addEventListener('wheel', onWheel, { passive: false });
    return () => header.removeEventListener('wheel', onWheel);
  }, []);

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
    ...(
      [
        ['tab:move-left', -1],
        ['tab:move-right', 1],
      ] as const
    ).map(([id, step]) => ({
      ...TAB_COMMANDS[id],
      isEnabled: () => neighbourTab(fileTabsState, activePath, step) !== null,
      execute: () => {
        const target = neighbourTab(fileTabsState, activePath, step);
        if (target !== null) {
          moveTab(activePath, target);
          setMoved((count) => count + 1);
        }
      },
    })),
  ];
  useRegisterCommands(commands);

  // A tab dropped on another takes its place: after it when it came from the left, before it when it came
  // from the right. The bar is drawn on that side.
  const dropSide = (key: string): 'before' | 'after' | undefined => {
    if (drag === null || drag.over !== key) {
      return undefined;
    }
    return order.indexOf(key) > order.indexOf(drag.from) ? 'after' : 'before';
  };

  const dragProps = (key: string): TabDragProps => ({
    onDragStart: (event) => {
      event.dataTransfer.setData(TAB_DRAG, key);
      event.dataTransfer.effectAllowed = 'move';
      setDrag({ from: key, over: null });
    },
    onDragOver: (event) => {
      if (drag === null || key === drag.from || fileTabsState[key]?.type === 'launcher') {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      if (drag.over !== key) {
        setDrag({ ...drag, over: key });
      }
    },
    onDragLeave: (event) => {
      // Leaving the tab for its own button or cross is not leaving it.
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
        return;
      }
      setDrag((current) => (current?.over === key ? { ...current, over: null } : current));
    },
    onDrop: (event) => {
      if (drag === null || drag.over !== key) {
        return;
      }
      event.preventDefault();
      moveTab(drag.from, key);
      setDrag(null);
    },
    onDragEnd: () => setDrag(null),
  });

  // A tab dragged toward an end of a strip wider than the window scrolls it, so a tab can be taken to a
  // place out of sight.
  const scrollWhileDragging = (event: React.DragEvent<HTMLDivElement>) => {
    if (drag === null) {
      return;
    }
    const header = event.currentTarget;
    const box = header.getBoundingClientRect();
    if (event.clientX < box.left + DRAG_EDGE) {
      header.scrollLeft -= DRAG_STEP;
    } else if (event.clientX > box.right - DRAG_EDGE) {
      header.scrollLeft += DRAG_STEP;
    }
  };

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
    <div className="tabHeader" ref={strip} onDragOver={scrollWhileDragging}>
      <ul className="tabList" role="tablist" aria-label="Open files">
        {Object.keys(fileTabsState).map((key) => (
          // Keyed by path, as the tab content is: by index, closing a tab moves every tab after it
          // into the DOM node of its neighbour.
          <Tab
            key={key}
            tab={fileTabsState[key]}
            ids={tabIds(group, key)}
            isDirty={unsavedTabs[key] !== undefined}
            onActivate={() => activateTab(key)}
            onClose={() => {
              refocus.current = true;
              requestClose([key]);
            }}
            onKeyDown={moveFocus}
            onMenu={(xPos, yPos) => setMenu({ key, xPos, yPos })}
            drop={dropSide(key)}
            isDragged={drag?.from === key}
            drag={dragProps(key)}
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

type TabDragProps = Pick<
  React.DOMAttributes<HTMLLIElement>,
  'onDragStart' | 'onDragOver' | 'onDragLeave' | 'onDrop' | 'onDragEnd'
>;

interface TabProps {
  tab: FileTab;
  /** This tab's id and its pane's: see tabIds.ts. */
  ids: { tab: string; panel: string };
  isDirty: boolean;
  onActivate: () => void;
  onClose: () => void;
  /** The strip's arrow keys, which need every tab and so are the strip's. */
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
  /** Opens the tab menu at a point in client coordinates. */
  onMenu: (xPos: number, yPos: number) => void;
  /** The side a tab being dragged over this one will land on. */
  drop?: 'before' | 'after';
  isDragged: boolean;
  drag: TabDragProps;
}

/**
 * One tab on the strip.
 *
 * The tooltip is the whole of what the tab cannot show: `.tabName` truncates with an ellipsis, so two
 * notebooks with a long shared prefix were the same tab, and the path rather than the name is what
 * tells two `main.py` apart. Whether it is unsaved goes on a second line rather than on the dot: the
 * dot is inside the tab, so a tooltip of its own would open on top of this one.
 */
function Tab({
  tab,
  ids,
  isDirty,
  onActivate,
  onClose,
  onKeyDown,
  onMenu,
  drop,
  isDragged,
  drag,
}: TabProps) {
  const tip = useTooltip();
  // A path names a file; the Launcher's, Help's and Settings' keys are not paths.
  const label = [
    tab.type === 'launcher' ||
    tab.type === 'help' ||
    tab.type === 'settings' ||
    tab.type === 'whats-new' ||
    tab.type === 'lsp-log' ||
    tab.type === 'data-viewer'
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
    <li
      className={[
        'tab-item',
        tab.name !== 'Launcher' ? 'is-closable' : '',
        drop === 'before' ? 'is-drop-before' : '',
        drop === 'after' ? 'is-drop-after' : '',
        isDragged ? 'is-dragged' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      role="presentation"
      {...drag}
    >
      <button
        type="button"
        role="tab"
        id={ids.tab}
        aria-selected={tab.active}
        aria-controls={ids.panel}
        // Only the tab in front is a Tab stop; the arrows go along the rest.
        tabIndex={tab.active ? 0 : -1}
        className={tab.active ? 'tab is-active' : 'tab'}
        // The Launcher stays first, so it is the one tab that cannot be picked up.
        draggable={tab.type !== 'launcher'}
        onClick={onActivate}
        onContextMenu={handleContextMenu}
        onKeyDown={(event) => {
          // The tab pattern's Delete, for every tab but the Launcher, which has no close.
          if (event.key === 'Delete' && tab.name !== 'Launcher') {
            event.preventDefault();
            onClose();
            return;
          }
          onKeyDown(event);
        }}
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
      </button>
      {tab.name !== 'Launcher' && (
        // Beside the tab rather than in it — a button inside a button is not one a keyboard or a
        // screen reader can reach — and drawn over its right edge. Hidden from both: a tab list holds
        // only tabs, and the keyboard's close is Delete on the tab, or Alt-W.
        <button
          type="button"
          className="z-icon-button on-chrome tab-close"
          aria-hidden="true"
          tabIndex={-1}
          onClick={onClose}
        >
          <Icon name="x" size={12} />
        </button>
      )}
      <Tooltip tip={tip} label={label} />
    </li>
  );
}
