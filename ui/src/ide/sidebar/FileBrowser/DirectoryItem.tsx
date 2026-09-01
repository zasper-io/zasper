/* eslint-disable jsx-a11y/anchor-is-valid */
import React, { useState } from 'react';
import { useAtom } from 'jotai';
import { v4 as uuidv4 } from 'uuid';

import {
  ContentType,
  createContent,
  deleteContent as deleteContentRequest,
  getDirectory,
  IContentEntry,
  logApiError,
  renameContent as renameContentRequest,
} from '@/api';
import ContextMenu from '../ContextMenu/ContextMenu';
import FileItem from './FileItem';
import { fileUploadParentPathAtom, showFileUploadDialogAtom } from './atoms';

export interface IDirectoryItemProps {
  parentDir: string;
  data: IContentEntry;
  handleTabActivate: (name: string, path: string, type: string, kernelspec: string) => void;
}

/**
 * A collapsible directory row. Children are fetched on expand rather than up
 * front, and this recurses into itself for nested directories.
 */
const DirectoryItem = ({ parentDir, data, handleTabActivate }: IDirectoryItemProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [content, setContent] = useState(data);
  const [text, setText] = useState(data.name);
  const [menuPosition, setMenuPosition] = useState<{
    xPos: number;
    yPos: number;
  } | null>(null);
  const [isMenuVisible, setIsMenuVisible] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isDeleted, setIsDeleted] = useState(false);
  const [contentName, setContentName] = useState(content.name);
  const [, setShowFileUploader] = useAtom(showFileUploadDialogAtom);
  const [, setFileUploadPath] = useAtom(fileUploadParentPathAtom);

  const loadDirectory = async (path: string) => {
    const directory = await getDirectory(path);
    directory.content.forEach((item) => {
      item.id = uuidv4();
    });
    setContent(directory);
  };

  const handleDirectoryClick = async (path: string) => {
    setIsCollapsed(!isCollapsed);
    await loadDirectory(path);
  };

  const createNewFile = async (path: string, contentType: ContentType) => {
    await createContent(path, contentType).catch(logApiError('Error creating content:'));
    await loadDirectory(path);
  };

  const renameContent = async () => {
    // check if the name is empty
    await renameContentRequest(parentDir, contentName, text).catch(
      logApiError('Error renaming content:')
    );
    setContentName(text);
    setIsEditing(false);
  };

  const deleteContent = async (path: string) => {
    await deleteContentRequest(path).catch(logApiError('Error deleting content:'));
    setIsDeleted(true);
  };

  const fileUploadFlow = () => {
    setShowFileUploader(true);
    setFileUploadPath(data.path);
  };

  const menuItems = [
    { label: 'Rename', action: () => setIsEditing(true) },
    {
      label: 'Add file',
      action: (path: string) => createNewFile(path, 'file'),
    },
    {
      label: 'Add Notebook',
      action: (path: string) => createNewFile(path, 'notebook'),
    },
    {
      label: 'Add Folder',
      action: (path: string) => createNewFile(path, 'directory'),
    },
    {
      label: 'Upload File',
      action: (path: string) => fileUploadFlow(),
    },
    { label: 'Delete Folder', action: (path: string) => deleteContent(path) },
  ];

  const handleRightClick = (e: React.MouseEvent, path: string) => {
    e.preventDefault();
    setMenuPosition({ xPos: e.pageX, yPos: e.pageY });
    setIsMenuVisible(true);
  };

  if (isDeleted) {
    return <></>;
  }

  return (
    <li className="fileItem">
      <a
        onContextMenu={(e) => handleRightClick(e, data.path)}
        onClick={() => handleDirectoryClick(data.path)}
      >
        <img className="directoryIcon" src="./images/editor/directory.svg" alt="" />
        {isEditing ? (
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => setIsEditing(false)}
            onKeyDown={(e) => e.key === 'Enter' && renameContent()}
            autoFocus
          />
        ) : (
          <span>{text}</span>
        )}
      </a>
      {isMenuVisible && menuPosition && (
        <ContextMenu
          xPos={menuPosition.xPos}
          yPos={menuPosition.yPos}
          items={menuItems}
          path={data.path}
          onClose={() => setIsMenuVisible(false)}
        />
      )}
      <ul className="file-list list-unstyled">
        {isCollapsed &&
          content.content !== null &&
          content.content.map((content, index) =>
            content.type === 'directory' ? (
              <DirectoryItem
                key={content.id}
                parentDir={data.path}
                handleTabActivate={handleTabActivate}
                data={content}
              />
            ) : (
              <FileItem
                parentDir={data.path}
                key={content.id}
                content={content}
                handleFileClick={handleTabActivate}
              />
            )
          )}
      </ul>
    </li>
  );
};

export default DirectoryItem;
