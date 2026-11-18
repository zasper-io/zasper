import type React from 'react';
import { useAtomValue } from 'jotai';

import { projectDirAtom } from '@/store/serverInfo';
import { useTabActions } from '@/store/tabActions';

/** Opens a file an agent names by its absolute path, when it is in the project. */
export function useOpenProjectFile() {
  const { openTab } = useTabActions();
  const projectDir = useAtomValue(projectDirAtom);
  return (path: string) => {
    const root = projectDir.endsWith('/') ? projectDir : `${projectDir}/`;
    if (!path.startsWith(root)) {
      return;
    }
    const relative = path.slice(root.length);
    const name = relative.split('/').pop() ?? relative;
    openTab({ name, path: relative, type: name.endsWith('.ipynb') ? 'notebook' : 'file' });
  };
}

/**
 * What a press on a link in an agent's words does. The agent links files by `file://` address: one
 * `openDoc` knows (a document it wrote for the reader) opens in its tab, one in the project opens as the
 * tree would, and any other goes nowhere. A web address leaves for a new browser tab, and a link the
 * sanitiser emptied does nothing, rather than either replacing the IDE.
 */
export function useFollowLink(openDoc?: (path: string) => boolean) {
  const openFile = useOpenProjectFile();
  return (event: React.MouseEvent) => {
    const link = (event.target as HTMLElement).closest('a');
    if (link === null) {
      return;
    }
    const href = link.getAttribute('href') ?? '';
    // A footnote or a heading in the same text.
    if (href.startsWith('#')) {
      return;
    }
    event.preventDefault();
    if (/^https?:\/\//.test(href)) {
      window.open(href, '_blank', 'noopener,noreferrer');
      return;
    }
    if (!href.startsWith('file:')) {
      return;
    }
    let path: string;
    try {
      path = decodeURIComponent(new URL(href).pathname);
    } catch {
      return;
    }
    if (!openDoc?.(path)) {
      openFile(path);
    }
  };
}
