/* eslint-disable jsx-a11y/anchor-is-valid */
import React, { useState } from 'react';
import { useSetAtom } from 'jotai';

import { IContentEntry } from '@/api';
import { baseName } from '@/paths';
import { useTabActions } from '@/store/TabActions';
import ContextMenu from '../ContextMenu/ContextMenu';
import ConfirmDeleteDialog from './ConfirmDeleteDialog';
import FileItem from './FileItem';
import RowName from './RowName';
import TreeStatus from './TreeStatus';
import { uploadRequestAtom } from './atoms';
import { describeEntry, rowClassName } from './entryDetails';
import { useClipboard } from './useClipboard';
import { useContentActions } from './useContentActions';
import { useDragSource, useDropTarget } from './useDragDrop';
import { useFileTree } from './useFileTree';
import { useRowDelete, useRowRename } from './useRowActions';
import { useSelection } from './useSelection';
import { useRowFocus } from './useTreeKeys';
import { useTreeRoot } from './useTreeRoot';

export interface IDirectoryItemProps {
  parentDir: string;
  data: IContentEntry;
  /** The tree's own first row, which is the one Tab reaches before anything has been focused. */
  isFirstRow?: boolean;
  handleTabActivate: (name: string, path: string, type: string, kernelspec: string) => void;
}

/**
 * A collapsible directory row. What it holds is read on expand rather than up front, and lives in the
 * tree store rather than here, so a reload can put the same folders back. This recurses into itself
 * for nested directories.
 */
const DirectoryItem = ({
  parentDir,
  data,
  isFirstRow = false,
  handleTabActivate,
}: IDirectoryItemProps) => {
  const { name, path } = data;
  const [menuPosition, setMenuPosition] = useState<{ xPos: number; yPos: number } | null>(null);
  const setUploadRequest = useSetAtom(uploadRequestAtom);
  const { visibleChildrenOf, isExpanded, toggle } = useFileTree();
  const { create, copyTo, copyPath } = useContentActions();
  const { openTerminal } = useTabActions();
  const clipboard = useClipboard();
  const selection = useSelection();
  const { openAsRoot } = useTreeRoot();
  const dragSource = useDragSource(path);
  const { isOver, ...dropTarget } = useDropTarget(path);
  const focusRow = useRowFocus(path, isFirstRow);
  const scope = selection.scopeFor(path);
  const rename = useRowRename(parentDir, name, path);
  const remove = useRowDelete(path, scope);
  const children = visibleChildrenOf(path);
  const rowClass =
    rowClassName(data, false, selection.isSelected(path)) + (isOver ? ' is-drop-target' : '');

  // Everything that acts on this folder as a destination is only offered when it alone is the row
  // being acted on; the rest of the menu applies to the whole selection.
  const forThisFolder =
    scope.length > 1
      ? []
      : [
          { label: 'Rename', action: rename.start },
          { label: 'Add file', action: () => create(path, 'file') },
          { label: 'Add Notebook', action: () => create(path, 'notebook') },
          { label: 'Add Folder', action: () => create(path, 'directory') },
          { label: 'Upload', action: () => setUploadRequest({ parentDir: path, pending: [] }) },
          { label: 'Open Terminal Here', action: () => openTerminal(path) },
          { label: 'Open as Root', action: () => openAsRoot(path) },
        ];

  const menuItems = [
    ...forThisFolder,
    { label: 'Cut', action: () => clipboard.cut(scope) },
    { label: 'Copy', action: () => clipboard.copy(scope) },
    ...(clipboard.held === null ? [] : [{ label: 'Paste', action: () => clipboard.paste(path) }]),
    { label: 'Duplicate', action: () => copyTo(scope, parentDir) },
    { label: 'Copy Path', action: () => copyPath(scope) },
    {
      label: scope.length > 1 ? `Delete ${scope.length} Items` : 'Delete Folder',
      action: remove.ask,
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
      aria-expanded={isExpanded(path)}
      aria-selected={selection.isSelected(path)}
      tabIndex={focusRow.tabIndex}
      onFocus={focusRow.onFocus}
    >
      <a
        {...dragSource}
        {...dropTarget}
        className={rowClass}
        title={describeEntry(data)}
        onContextMenu={handleRightClick}
        onClick={(event) => {
          if (!selection.handleClick(path, event)) {
            toggle(path);
          }
        }}
      >
        <img className="directoryIcon" src="./images/editor/directory.svg" alt="" />
        <RowName name={name} rename={rename} />
        {data.writable === false && <i className="fas fa-lock rowFlag" aria-label="Read-only" />}
      </a>
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
          isFolder
          deleting={remove.deleting}
          onConfirm={remove.confirm}
          onCancel={remove.cancel}
        />
      )}
      {isExpanded(path) && (
        <ul className="file-list list-unstyled" role="group">
          {children.map((child) =>
            child.type === 'directory' ? (
              <DirectoryItem
                key={child.path}
                parentDir={path}
                handleTabActivate={handleTabActivate}
                data={child}
              />
            ) : (
              <FileItem
                key={child.path}
                parentDir={path}
                content={child}
                onOpen={handleTabActivate}
              />
            )
          )}
          <TreeStatus path={path} visible={children.length} />
        </ul>
      )}
    </li>
  );
};

export default DirectoryItem;
