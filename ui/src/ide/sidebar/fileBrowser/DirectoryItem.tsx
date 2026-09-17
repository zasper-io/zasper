import React, { useRef, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';

import { ContentEntry } from '@/api';
import { Icon } from '@/ide/icons';
import { useTooltip } from '@/ide/overlays';
import Tooltip from '@/ide/Tooltip';
import { baseName } from '@/paths';
import { terminalsAvailableAtom } from '@/store/serverInfo';
import { useTabActions } from '@/store/tabActions';
import ContextMenu from '../contextMenu/ContextMenu';
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

export interface DirectoryItemProps {
  parentDir: string;
  data: ContentEntry;
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
}: DirectoryItemProps) => {
  const { name, path } = data;
  const [menuPosition, setMenuPosition] = useState<{ xPos: number; yPos: number } | null>(null);
  const setUploadRequest = useSetAtom(uploadRequestAtom);
  const { visibleChildrenOf, isExpanded, toggle } = useFileTree();
  const { create, copyTo, copyPath } = useContentActions();
  const { openTerminal } = useTabActions();
  const terminalsAvailable = useAtomValue(terminalsAvailableAtom);
  const clipboard = useClipboard();
  const selection = useSelection();
  const { openAsRoot } = useTreeRoot();
  const dragSource = useDragSource(path);
  const { isOver, ...dropTarget } = useDropTarget(path);
  const focusRow = useRowFocus(path, isFirstRow);
  // What the row has no width for — the path, the size, when it changed, whether it is writable. The
  // row and not the `li`: this `li` is the whole expanded folder, so labelling it would put the box
  // under the last of the children and describe the folder while the pointer is on one of them.
  const rowRef = useRef<HTMLAnchorElement>(null);
  const tip = useTooltip(true, rowRef);
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
          ...(terminalsAvailable
            ? [
                {
                  label: 'Open Terminal Here',
                  icon: 'terminal' as const,
                  action: () => openTerminal(path),
                },
              ]
            : []),
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
      {...tip.focusProps}
      // The `li` is what takes the focus, so the tooltip's own focus handler runs beside the one that
      // remembers where the keyboard is, rather than instead of it.
      onFocus={(event) => {
        focusRow.onFocus(event);
        tip.focusProps.onFocus(event);
      }}
    >
      <a
        ref={rowRef}
        {...dragSource}
        {...dropTarget}
        {...tip.hoverProps}
        className={rowClass}
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
          <span className="rowFlag" role="img" aria-label="Read-only">
            <Icon name="lock" size={12} />
          </span>
        )}
      </a>
      <Tooltip tip={tip} label={describeEntry(data)} />
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
