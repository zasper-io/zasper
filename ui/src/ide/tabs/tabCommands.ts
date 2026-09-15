import { defineCommands } from '@/commands/define';
import { diskComparePath } from '@/store/diskChanges';
import type { FileTab, FileTabDict } from '@/store/tabState';

const TAB = { category: 'Tab', scope: 'app' } as const;

/**
 * The tab strip's commands, which act on the tab in front; the tab menu runs the same ones on the tab it
 * was opened on. Alt rather than Mod, because ⌘W and Ctrl-W close the browser's own tab before the page
 * is asked.
 */
export const TAB_COMMANDS = defineCommands({
  'tab:close': { ...TAB, label: 'Close', keys: ['Alt-w'] },
  'tab:close-others': { ...TAB, label: 'Close Others', keys: ['Alt-Shift-o'] },
  'tab:close-right': { ...TAB, label: 'Close to the Right', keys: ['Alt-Shift-r'] },
  'tab:close-left': { ...TAB, label: 'Close to the Left', keys: ['Alt-Shift-l'] },
  'tab:close-saved': { ...TAB, label: 'Close Saved', keys: ['Alt-Shift-s'] },
  'tab:close-all': { ...TAB, label: 'Close All', keys: ['Alt-Shift-w'] },
  'tab:reopen': { ...TAB, label: 'Reopen Closed Tab', keys: ['Alt-Shift-t'] },
  'tab:copy-path': { ...TAB, label: 'Copy Path' },
  'tab:reveal': { ...TAB, label: 'Reveal in File Explorer' },
});

/** Which tabs a close takes, measured from the tab it was asked on. */
export type CloseScope = 'this' | 'others' | 'right' | 'left' | 'saved' | 'all';

/** The closes, in the order the menu lists them. */
export const CLOSE_COMMANDS = [
  { id: 'tab:close', scope: 'this' },
  { id: 'tab:close-others', scope: 'others' },
  { id: 'tab:close-right', scope: 'right' },
  { id: 'tab:close-left', scope: 'left' },
  { id: 'tab:close-saved', scope: 'saved' },
  { id: 'tab:close-all', scope: 'all' },
] as const satisfies readonly { id: keyof typeof TAB_COMMANDS; scope: CloseScope }[];

/**
 * The tabs a close takes, in strip order. Never the Launcher: it has no ×, and it is what comes to the
 * front when nothing else is left there. A terminal or Help has nothing to save, so it counts as saved.
 */
export function tabsToClose(
  tabs: FileTabDict,
  target: string,
  scope: CloseScope,
  unsaved: Record<string, unknown>
): string[] {
  const order = Object.keys(tabs);
  const at = order.indexOf(target);
  if (at === -1) {
    return [];
  }

  const inScope = (key: string, index: number): boolean => {
    switch (scope) {
      case 'this':
        return key === target;
      case 'others':
        return key !== target;
      case 'right':
        return index > at;
      case 'left':
        return index < at;
      case 'saved':
        return unsaved[key] === undefined;
      case 'all':
        return true;
    }
  };
  return order.filter((key, index) => inScope(key, index) && tabs[key].type !== 'launcher');
}

/** Whether a close leaves the tab it was asked on, which then comes to the front if the front tab went. */
export function keepsTarget(scope: CloseScope): boolean {
  return scope === 'others' || scope === 'right' || scope === 'left';
}

/** The file a tab is about, for Copy Path and Reveal; null for the tabs that are not a file. */
export function tabFilePath(tab: FileTab): string | null {
  if (
    tab.type === 'launcher' ||
    tab.type === 'terminal' ||
    tab.type === 'help' ||
    tab.type === 'settings'
  ) {
    return null;
  }
  if (tab.type === 'disk-diff') {
    return diskComparePath(tab.path);
  }
  return tab.diff?.path ?? tab.path;
}
