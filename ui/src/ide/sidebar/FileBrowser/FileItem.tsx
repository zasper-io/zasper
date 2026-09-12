/* eslint-disable jsx-a11y/anchor-is-valid */
import React, { useState } from 'react';
import { useAtomValue } from 'jotai';

import { IContentEntry } from '@/api';
import { FileMark, Icon } from '@/ide/icons';
import { useTooltip } from '@/ide/overlays';
import Tooltip from '@/ide/Tooltip';
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
  // What the row has no width for — the path, the size, when it changed, whether it is writable.
  const tip = useTooltip();
  const { copyTo, copyPath, download } = useContentActions();

  const menuItems = [
    // Renaming is one row's business; the rest of the menu is the selection's.
    ...(scope.length > 1
      ? []
      : [{ label: 'Rename', icon: 'pencil' as const, action: rename.start }]),
    { label: 'Cut', icon: 'scissors' as const, action: () => clipboard.cut(scope) },
    { label: 'Copy', icon: 'copy' as const, action: () => clipboard.copy(scope) },
    // A duplicate is a copy into the folder the file is already in; the server picks the free name.
    { label: 'Duplicate', icon: 'files' as const, action: () => copyTo(scope, parentDir) },
    { label: 'Copy Path', icon: 'link' as const, action: () => copyPath(scope) },
    { label: 'Download', icon: 'download' as const, action: () => download(scope) },
    {
      label: scope.length > 1 ? `Delete ${scope.length} Items` : 'Delete',
      icon: 'trash-2' as const,
      action: remove.ask,
      danger: true,
    },
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
      {...tip.anchorProps}
      // The row is what takes the focus, so the tooltip's own focus handler runs beside the one that
      // remembers where the keyboard is, rather than instead of it.
      onFocus={(event) => {
        focusRow.onFocus(event);
        tip.anchorProps.onFocus(event);
      }}
    >
      <a
        {...dragSource}
        className={rowClassName(content, activePath === path, selection.isSelected(path))}
        onClick={(event) => {
          // A cmd- or shift-click is building a selection and nothing more; a plain click opens.
          if (!selection.handleClick(path, event)) {
            onOpen(name, path, content.type, 'none');
          }
        }}
        onContextMenu={handleRightClick}
      >
        <FileMark name={name} />
        <RowName name={name} rename={rename} />
        {content.writable === false && (
          // The lock is the only icon in the tree that is information rather than decoration, so
          // unlike <Icon> itself it needs a name of its own.
          <span className="rowFlag" role="img" aria-label="Read-only">
            <Icon name="lock" size={12} />
          </span>
        )}
      </a>
      <Tooltip tip={tip} label={describeEntry(content)} />
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
