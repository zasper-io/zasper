import { useTabActions } from '@/store/TabActions';
import { ICommand } from './types';

export const DOCS_URL = 'https://zasper.io/docs';
export const ISSUES_URL = 'https://github.com/zasper-io/zasper/issues/new';

function openExternal(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * Help, reachable from the palette and from a key. F1 rather than `Mod-/`: that is CodeMirror's
 * toggle-comment, and an app command still fires while a cell has focus.
 *
 * Not memoized, like the notebook's: `useRegisterCommands` re-registers only when the ids change.
 */
export function useHelpCommands(): ICommand[] {
  const { openHelp } = useTabActions();

  return [
    {
      id: 'help:shortcuts',
      label: 'Keyboard Shortcuts',
      category: 'Help',
      scope: 'app',
      keys: ['F1'],
      execute: () => openHelp(),
    },
    {
      id: 'help:about',
      label: 'About Zasper',
      category: 'Help',
      scope: 'app',
      execute: () => openHelp('about'),
    },
    {
      id: 'help:docs',
      label: 'Documentation',
      category: 'Help',
      scope: 'app',
      execute: () => openExternal(DOCS_URL),
    },
    {
      id: 'help:report-issue',
      label: 'Report an Issue',
      category: 'Help',
      scope: 'app',
      execute: () => openExternal(ISSUES_URL),
    },
  ];
}
