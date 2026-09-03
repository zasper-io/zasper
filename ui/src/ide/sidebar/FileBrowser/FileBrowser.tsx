import React, { useEffect, useState } from 'react';
import { useAtom, useSetAtom } from 'jotai';

import { useTabActions } from '@/store/TabActions';
import ContextMenu from '../ContextMenu/ContextMenu';
import Breadcrumb from './Breadcrumb';
import DirectoryItem from './DirectoryItem';
import FileItem from './FileItem';
import FileUpload from './FileUpload';
import TreeStatus from './TreeStatus';
import {
  fileBrowserErrorAtom,
  showHiddenFilesAtom,
  treeFilterAtom,
  uploadRequestAtom,
} from './atoms';
import { useClipboard } from './useClipboard';
import { useContentActions } from './useContentActions';
import { useContentWatcher } from './useContentWatcher';
import { useDropTarget } from './useDragDrop';
import { useFileTree } from './useFileTree';
import { useSelection } from './useSelection';
import { useTreeKeys } from './useTreeKeys';
import { useTreeRoot } from './useTreeRoot';

interface FileBrowserProps {
  hidden: boolean;
  reloadCount: number;
}

export default function FileBrowser({ hidden, reloadCount }: FileBrowserProps) {
  const [uploadRequest, setUploadRequest] = useAtom(uploadRequestAtom);
  const [error, setError] = useAtom(fileBrowserErrorAtom);
  const [filter, setFilter] = useAtom(treeFilterAtom);
  const [showHidden, setShowHidden] = useAtom(showHiddenFilesAtom);
  const [menuPosition, setMenuPosition] = useState<{ xPos: number; yPos: number } | null>(null);
  const { visibleChildrenOf, read, refresh, collapseAll } = useFileTree();
  const { create } = useContentActions();
  const { openTab, openTerminal } = useTabActions();
  const clipboard = useClipboard();
  const selection = useSelection();
  const { root } = useTreeRoot();
  const rootDrop = useDropTarget(root);
  const handleTreeKeys = useTreeKeys();
  const rootChildren = visibleChildrenOf(root);

  const handleTabActivate = (name: string, path: string, type: string, kernelspec: string) => {
    openTab({ name, path, type, kernelspec });
  };

  // Only the root: a file created from the Launcher lands there, and whatever is open below should
  // stay as the user left it. Also the one place the root is read after re-rooting into a folder,
  // which is why the whole panel has just the one of these.
  useEffect(() => {
    read(root);
  }, [read, root, reloadCount]);

  useContentWatcher(refresh);

  const uploadTo = (parentDir: string) => setUploadRequest({ parentDir, pending: [] });

  // The same actions a folder's own menu offers, for the root, which has no row to right-click.
  const rootMenuItems = [
    { label: 'Add file', action: () => create(root, 'file') },
    { label: 'Add Notebook', action: () => create(root, 'notebook') },
    { label: 'Add Folder', action: () => create(root, 'directory') },
    { label: 'Upload', action: () => uploadTo(root) },
    { label: 'Open Terminal Here', action: () => openTerminal(root) },
    ...(clipboard.held === null ? [] : [{ label: 'Paste', action: () => clipboard.paste(root) }]),
    { label: 'Refresh', action: () => refresh() },
  ];

  const handleRightClick = (e: React.MouseEvent) => {
    e.preventDefault();
    setMenuPosition({ xPos: e.clientX, yPos: e.clientY });
  };

  // A click on the empty space below the tree drops the selection. Rows do not stop their clicks
  // propagating, so this has to tell one that came from a row from one that did not.
  const handleBackgroundClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.fileItem') === null) {
      selection.clear();
    }
  };

  return (
    <>
      <div className={hidden ? 'nav-content is-hidden' : 'nav-content'}>
        <div className="content-head">
          <div className="z-label">File explorer</div>
        </div>
        {/* The one place the project banner is right: it names the thing this panel
            is a view of — which is the project, or a folder inside it. */}
        <div className="projectBanner">
          <Breadcrumb />
          <div className="projectButtons">
            <button className="editor-button" onClick={() => create(root, 'file')} title="New file">
              <img src="./images/editor/feather-file-plus.svg" alt="" />
            </button>
            <button
              className="editor-button"
              onClick={() => create(root, 'notebook')}
              title="New notebook"
            >
              <img className="notebookIcon" src="./images/editor/jupyter-icon.svg" alt="" />
            </button>
            <button
              className="editor-button"
              onClick={() => create(root, 'directory')}
              title="New folder"
            >
              <img src="./images/editor/feather-folder-plus.svg" alt="" />
            </button>
            <button className="editor-button" onClick={() => uploadTo(root)} title="Upload file">
              <i className="fas fa-upload"></i>
            </button>
            {/* The watcher misses whatever its exclusion list covers — anything with `test`, `dist`
                or `tmp` anywhere in its path — so there has to be a way to ask. */}
            <button className="editor-button" onClick={() => refresh()} title="Refresh">
              <i className="fas fa-sync"></i>
            </button>
          </div>
        </div>
        <div className="treeToolbar">
          <input
            className="treeFilter"
            type="search"
            value={filter}
            placeholder="Filter"
            aria-label="Filter files"
            onChange={(e) => setFilter(e.target.value)}
          />
          <button
            className="editor-button"
            onClick={collapseAll}
            title="Collapse all folders"
            aria-label="Collapse all folders"
          >
            <i className="fas fa-angle-double-up"></i>
          </button>
          <button
            className="editor-button"
            onClick={() => setShowHidden(!showHidden)}
            title={showHidden ? 'Hide hidden files' : 'Show hidden files'}
            aria-label="Show hidden files"
            aria-pressed={showHidden}
          >
            <i className={showHidden ? 'fas fa-eye' : 'fas fa-eye-slash'}></i>
          </button>
        </div>
        {error !== '' && (
          <div className="panel-error" role="alert">
            <p>{error}</p>
            <button type="button" aria-label="Dismiss" onClick={() => setError('')}>
              <i className="fas fa-times-circle"></i>
            </button>
          </div>
        )}
        <div
          className={rootDrop.isOver ? 'content-inner is-drop-target' : 'content-inner'}
          onContextMenu={handleRightClick}
          onClick={handleBackgroundClick}
          onDragOver={rootDrop.onDragOver}
          onDragLeave={rootDrop.onDragLeave}
          onDrop={rootDrop.onDrop}
        >
          <ul
            className="file-list list-unstyled noborder-list"
            role="tree"
            aria-label="Files"
            aria-multiselectable="true"
            onKeyDown={handleTreeKeys}
          >
            {rootChildren.map((content, index) =>
              content.type === 'directory' ? (
                <DirectoryItem
                  key={content.path}
                  parentDir={root}
                  data={content}
                  isFirstRow={index === 0}
                  handleTabActivate={handleTabActivate}
                />
              ) : (
                <FileItem
                  key={content.path}
                  parentDir={root}
                  content={content}
                  isFirstRow={index === 0}
                  onOpen={handleTabActivate}
                />
              )
            )}
            <TreeStatus path={root} visible={rootChildren.length} />
          </ul>
        </div>
      </div>
      {menuPosition && (
        <ContextMenu
          xPos={menuPosition.xPos}
          yPos={menuPosition.yPos}
          items={rootMenuItems}
          path={root}
          onClose={() => setMenuPosition(null)}
        />
      )}
      {/* A fixed-position dialog, so it is a sibling of the panel rather than a
          child of its scroll area. */}
      {uploadRequest !== null && <FileUpload />}
    </>
  );
}
