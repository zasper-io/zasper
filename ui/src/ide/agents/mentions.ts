import { useCallback } from 'react';
import { useSetAtom } from 'jotai';

import { Mention, NotebookCell, NotebookOutput } from '@/api';
import { agentPanelOpenAtom, composerMentionsAtom } from '@/store/agents';
import { terminalText } from './chatLog';

const baseName = (path: string) => path.split('/').pop() ?? path;

export function fileMention(path: string): Mention {
  return { kind: 'file', path, label: baseName(path) };
}

/** A cell, by its number as the reader sees it, with its source as it is on screen. */
export function cellMention(path: string, cell: NotebookCell, index: number): Mention {
  return {
    kind: 'cell',
    path,
    label: `${baseName(path)} · cell ${index + 1}`,
    cell_id: cell.id,
    text: cell.source,
  };
}

/**
 * A cell's outputs as text: streams, plain text, and an error as its traceback, which already names it,
 * without their colours.
 */
export function outputMention(path: string, cell: NotebookCell, index: number): Mention {
  const text = (cell.outputs ?? []).map(textOf).filter((part) => part !== '');
  return {
    kind: 'output',
    path,
    label: `${baseName(path)} · output ${index + 1}`,
    cell_id: cell.id,
    text: terminalText(text.join('\n')),
  };
}

function textOf(output: NotebookOutput): string {
  if (output.output_type === 'error') {
    return output.traceback?.length
      ? output.traceback.join('\n')
      : `${output.ename}: ${output.evalue ?? ''}`;
  }
  const plain = output.data?.['text/plain'] ?? output['text/plain'];
  return (
    output.text ?? (Array.isArray(plain) ? plain.join('') : typeof plain === 'string' ? plain : '')
  );
}

const same = (a: Mention, b: Mention) =>
  a.kind === b.kind && a.path === b.path && a.cell_id === b.cell_id;

/**
 * Adds to what the composer's next message mentions, and opens the panel to it. A mention already
 * there is taken again, so a cell added twice carries what it says now.
 */
export function useAddMention(): (mention: Mention) => void {
  const setMentions = useSetAtom(composerMentionsAtom);
  const setPanelOpen = useSetAtom(agentPanelOpenAtom);
  return useCallback(
    (mention: Mention) => {
      setMentions((mentions) => [...mentions.filter((each) => !same(each, mention)), mention]);
      setPanelOpen(true);
    },
    [setMentions, setPanelOpen]
  );
}
