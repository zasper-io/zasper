import React from 'react';

import { IRowRename } from './useRowActions';

interface RowNameProps {
  /** The name on disk, which is what the row shows unless it is being renamed. */
  name: string;
  rename: IRowRename;
}

/** The label of a row in the tree, or its rename box. */
export default function RowName({ name, rename }: RowNameProps) {
  if (!rename.isEditing) {
    // The class is what lets a long name end in an ellipsis instead of running out of the panel;
    // the row's own `title` is where the whole name stays readable. See `.rowName` in _panel.scss.
    return <span className="rowName">{name}</span>;
  }

  return (
    <input
      type="text"
      className="rowNameInput"
      value={rename.text}
      onChange={(event) => rename.onChange(event.target.value)}
      // The box sits inside the row, whose click opens the file or the folder.
      onClick={(event) => event.stopPropagation()}
      onBlur={rename.cancel}
      // What is on disk, which is only worth showing while the box is empty: after a create that is
      // the server's `untitled.ipynb`, and with it greyed there the extension to type is not a guess.
      placeholder={name}
      onKeyDown={(event: React.KeyboardEvent) => {
        if (event.key === 'Enter') {
          rename.submit();
        } else if (event.key === 'Escape') {
          rename.cancel();
        }
      }}
      autoFocus
    />
  );
}
