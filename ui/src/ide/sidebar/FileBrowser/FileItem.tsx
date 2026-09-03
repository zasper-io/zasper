/* eslint-disable jsx-a11y/anchor-is-valid */
import React, { useState } from 'react';
import { useAtomValue } from 'jotai';

import { IContentEntry } from '@/api';
import { getIconToLoad } from '@/ide/utils';
import { baseName } from '@/paths';
import { activeTabPathAtom } from '@/store/TabState';
import ContextMenu from '../ContextMenu/ContextMenu';
import ConfirmDeleteDialog from './ConfirmDeleteDialog';
import RowName from './RowName';
import { describeEntry, rowClassName } from './entryDetails';
import { useClipboard } from './useClipboard';
import { useContentActions } from './useContentActions';
import { useDragSource } from './useDragDrop';
import { useRowDelete, useRowRename } from './useRowActions';
import { useSelection } from './useSelection';
import { useRowFocus } from './useTreeKeys';

export interface IFileItemProps {
  parentDir: string;
  content: IContentEntry;
  /** The tree's own first row, which is the one Tab reaches before anything has been focused. */
  isFirstRow?: boolean;
  onOpen: (name: string, path: string, type: string, kernelspec: string) => void;
}

/** A single file row, with inline rename and a right-click menu. */
const FileItem = ({ parentDir, content, isFirstRow = false, onOpen }: IFileItemProps) => {
  const { name, path } = content;
  const [menuPosition, setMenuPosition] = useState<{ xPos: number; yPos: number } | null>(null);
  const activePath = useAtomValue(activeTabPathAtom);
  const selection = useSelection();
  const scope = selection.scopeFor(path);
  const rename = useRowRename(parentDir, name, path);
  const remove = useRowDelete(path, scope);
  const clipboard = useClipboard();
  const dragSource = useDragSource(path);
  const focusRow = useRowFocus(path, isFirstRow);
  const { copyTo, copyPath, download } = useContentActions();

  const menuItems = [
    // Renaming is one row's business; the rest of the menu is the selection's.
    ...(scope.length > 1 ? [] : [{ label: 'Rename', action: rename.start }]),
    { label: 'Cut', action: () => clipboard.cut(scope) },
    { label: 'Copy', action: () => clipboard.copy(scope) },
    // A duplicate is a copy into the folder the file is already in; the server picks the free name.
    { label: 'Duplicate', action: () => copyTo(scope, parentDir) },
    { label: 'Copy Path', action: () => copyPath(scope) },
    { label: 'Download', action: () => download(scope) },
    { label: scope.length > 1 ? `Delete ${scope.length} Items` : 'Delete', action: remove.ask },
  ];

  const handleRightClick = (e: React.MouseEvent) => {
    e.preventDefault();
    // Otherwise this also reaches the empty space behind the tree, which has a menu of its own.
    e.stopPropagation();
    selection.ensureSelected(path);
    setMenuPosition({ xPos: e.clientX, yPos: e.clientY });
  };

  return (
    <li
      ref={focusRow.ref}
      className="fileItem"
      role="treeitem"
      aria-selected={selection.isSelected(path)}
      tabIndex={focusRow.tabIndex}
      onFocus={focusRow.onFocus}
    >
      <a
        {...dragSource}
        className={rowClassName(content, activePath === path, selection.isSelected(path))}
        title={describeEntry(content)}
        onClick={(event) => {
          // A cmd- or shift-click is building a selection and nothing more; a plain click opens.
          if (!selection.handleClick(path, event)) {
            onOpen(name, path, content.type, 'none');
          }
        }}
        onContextMenu={handleRightClick}
      >
        <img src={getIconToLoad(name)} alt="" />
        <RowName name={name} rename={rename} />
        {content.writable === false && <i className="fas fa-lock rowFlag" aria-label="Read-only" />}
      </a>
      {/* A sibling of the row, not a child of it: inside the link, a click on a menu item counted
          as a click on the file. */}
      {menuPosition && (
        <ContextMenu
          xPos={menuPosition.xPos}
          yPos={menuPosition.yPos}
          items={menuItems}
          path={path}
          onClose={() => setMenuPosition(null)}
        />
      )}
      {remove.asking && (
        <ConfirmDeleteDialog
          names={scope.map(baseName)}
          isFolder={false}
          deleting={remove.deleting}
          onConfirm={remove.confirm}
          onCancel={remove.cancel}
        />
      )}
    </li>
  );
};

export default FileItem;
