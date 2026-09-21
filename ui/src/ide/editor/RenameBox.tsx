import React, { useEffect, useRef, useState } from 'react';

import { useDismissOnPressOutside } from '@/ide/overlays';
import { RenameReach } from '@/lsp/rename';

interface RenameBoxProps {
  /** The name as it stands, which the field opens with, selected. */
  symbol: string;
  /** Where the name is, in the editor area's own pixels. */
  at: { left: number; top: number };
  /** How far the rename reaches, once the server has said. */
  reach: RenameReach | null;
  onRename: (newName: string) => void;
  onClose: () => void;
}

/**
 * The field a rename is asked for in, over the name being renamed.
 *
 * The count under it is the server's own: how many places the name is used, and how many of their files
 * have no editor — those are written on disk, where `⌘Z` cannot reach them.
 */
export default function RenameBox(props: RenameBoxProps) {
  const [name, setName] = useState(props.symbol);
  const box = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);

  useDismissOnPressOutside(box, props.onClose);
  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);

  const reach = props.reach;
  const said =
    reach === null
      ? 'Counting the uses…'
      : `${reach.uses} ${reach.uses === 1 ? 'use' : 'uses'} in ${reach.files} ${
          reach.files === 1 ? 'file' : 'files'
        }${reach.notOpen > 0 ? ` · ${reach.notOpen} not open` : ''}`;

  return (
    <div
      className="z-overlay rename-box"
      ref={box}
      style={{ left: props.at.left, top: props.at.top }}
    >
      <input
        ref={field}
        className="z-field rename-field"
        type="text"
        value={name}
        aria-label="New name"
        spellCheck={false}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && name.trim() !== '' && name !== props.symbol) {
            event.preventDefault();
            props.onRename(name.trim());
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            props.onClose();
          }
        }}
      />
      <span className="rename-count">
        <span>{said}</span>
        <span className="panel-row-keys">⏎</span>
      </span>
    </div>
  );
}
