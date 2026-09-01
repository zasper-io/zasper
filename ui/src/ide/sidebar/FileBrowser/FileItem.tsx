/* eslint-disable jsx-a11y/anchor-is-valid */
import React, { useState } from 'react';

import {
  deleteContent as deleteContentRequest,
  IContentEntry,
  logApiError,
  renameContent as renameContentRequest,
} from '@/api';
import { getIconToLoad } from '@/ide/utils';
import ContextMenu from '../ContextMenu/ContextMenu';

export interface IFileItemProps {
  parentDir: string;
  content: IContentEntry;
  handleFileClick: (name: string, path: string, type: string, kernelspec: string) => void;
}

/** A single file row, with inline rename and a right-click menu. */
const FileItem = ({ parentDir, content, handleFileClick }: IFileItemProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [contentName, setContentName] = useState(content.name);
  const [text, setText] = useState(content.name);
  const [menuPosition, setMenuPosition] = useState<{
    xPos: number;
    yPos: number;
  } | null>(null);
  const [isMenuVisible, setIsMenuVisible] = useState(false);
  const [icon, setIcon] = useState(getIconToLoad(content.name));
  const [isDeleted, setIsDeleted] = useState(false);

  const renameContent = async () => {
    await renameContentRequest(parentDir, contentName, text).catch(
      logApiError('Error renaming content:')
    );
    setContentName(text);
    setIcon(getIconToLoad(text));
    setIsEditing(false);
  };

  const deleteContent = async () => {
    await deleteContentRequest(getPath()).catch(logApiError('Error deleting content:'));
    setIsDeleted(true);
  };

  const menuItems = [
    {
      label: 'Rename',
      action: (path: string) => {
        setIsEditing(true);
      },
    },
    {
      label: 'Delete',
      action: (path: string) => {
        deleteContent();
      },
    },
  ];

  const handleRightClick = (e: React.MouseEvent, path: string) => {
    e.preventDefault();
    setMenuPosition({ xPos: e.pageX, yPos: e.pageY });
    setIsMenuVisible(true);
  };

  const getPath = () => {
    if (parentDir === '') {
      return text;
    } else {
      return parentDir + '/' + text;
    }
  };

  const handleClick = (name: string, path: string, type: string) => {
    if (!isMenuVisible) {
      handleFileClick(name, getPath(), type, 'none');
    }
  };

  if (isDeleted) {
    return <></>;
  }

  return (
    <li className="fileItem">
      <a
        onClick={() => handleClick(text, content.path, content.type)}
        onContextMenu={(e) => handleRightClick(e, content.path)}
      >
        <img src={icon} alt="" />
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
        {isMenuVisible && menuPosition && (
          <ContextMenu
            xPos={menuPosition.xPos}
            yPos={menuPosition.yPos}
            items={menuItems}
            path={content.path}
            onClose={() => setIsMenuVisible(false)}
          />
        )}
      </a>
    </li>
  );
};

export default FileItem;
