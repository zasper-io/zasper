/* eslint-disable jsx-a11y/anchor-is-valid */
import React, { useState } from 'react';
import { useSetAtom } from 'jotai';

import { IContentEntry } from '@/api';
import { Icon } from '@/ide/icons';
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
    'is-directory ' +
    rowClassName(data, false, selection.isSelected(path)) +
    (isOver ? ' is-drop-target' : '');

  // Everything that acts on this folder as a destination is only offered when it alone is the row
  // being acted on; the rest of the menu applies to the whole selection.
  const forThisFolder =
    scope.length > 1
      ? []
      : [
          { label: 'Rename', icon: 'pencil' as const, action: rename.start },
          { label: 'Add file', icon: 'file-plus' as const, action: () => create(path, 'file') },
          {
            label: 'Add Notebook',
            icon: 'notebook-pen' as const,
            action: () => create(path, 'notebook'),
          },
          {
            label: 'Add Folder',
            icon: 'folder-plus' as const,
            action: () => create(path, 'directory'),
          },
          {
            label: 'Upload',
            icon: 'upload' as const,
            action: () => setUploadRequest({ parentDir: path, pending: [] }),
          },
          {
            label: 'Open Terminal Here',
            icon: 'terminal' as const,
            action: () => openTerminal(path),
          },
          { label: 'Open as Root', icon: 'folder-open' as const, action: () => openAsRoot(path) },
        ];

  const menuItems = [
    ...forThisFolder,
    { label: 'Cut', icon: 'scissors' as const, action: () => clipboard.cut(scope) },
    { label: 'Copy', icon: 'copy' as const, action: () => clipboard.copy(scope) },
    {
      label: 'Paste',
      icon: 'clipboard-paste' as const,
      disabled: clipboard.held === null,
      action: () => clipboard.paste(path),
    },
    { label: 'Duplicate', icon: 'files' as const, action: () => copyTo(scope, parentDir) },
    { label: 'Copy Path', icon: 'link' as const, action: () => copyPath(scope) },
    {
      label: scope.length > 1 ? `Delete ${scope.length} Items` : 'Delete Folder',
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
        <Icon
          name={isExpanded(path) ? 'chevron-down' : 'chevron-right'}
          size={12}
          className="row-disclosure"
        />
        <Icon name="folder" />
        <RowName name={name} rename={rename} />
        {data.writable === false && (
          <span className="rowFlag" role="img" aria-label="Read-only" title="Read-only">
            <Icon name="lock" size={12} />
          </span>
        )}
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
        <ul className="file-list z-list-plain" role="group">
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
