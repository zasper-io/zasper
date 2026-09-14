import { useTabActions } from '@/store/TabActions';
import { defineCommands } from './define';
import { ICommand } from './types';

export const DOCS_URL = 'https://zasper.io/docs';
export const ISSUES_URL = 'https://github.com/zasper-io/zasper/issues/new';

const help = { category: 'Help', scope: 'app' } as const;

export const HELP_COMMANDS = defineCommands({
  // F1 rather than `Mod-/`: that is CodeMirror's toggle-comment, and an app command with a modifier
  // still fires while a cell has focus.
  'help:shortcuts': { ...help, label: 'Keyboard Shortcuts', keys: ['F1'] },
  'help:about': { ...help, label: 'About Zasper' },
  'help:docs': { ...help, label: 'Documentation' },
  'help:report-issue': { ...help, label: 'Report an Issue' },
});

function openExternal(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}

/** Not memoized, like the notebook's: `useRegisterCommands` re-registers only when the ids change. */
export function useHelpCommands(): ICommand[] {
  const { openHelp } = useTabActions();

  return [
    { ...HELP_COMMANDS['help:shortcuts'], execute: () => openHelp() },
    { ...HELP_COMMANDS['help:about'], execute: () => openHelp('about') },
    { ...HELP_COMMANDS['help:docs'], execute: () => openExternal(DOCS_URL) },
    { ...HELP_COMMANDS['help:report-issue'], execute: () => openExternal(ISSUES_URL) },
  ];
}
