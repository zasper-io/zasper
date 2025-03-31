/* eslint-disable jsx-a11y/anchor-is-valid */
import React, { useCallback, useEffect, useState } from 'react';
import ContextMenu from '../ContextMenu';
import getFileExtension from '../../utils';
import { useAtom } from 'jotai';
import { v4 as uuidv4 } from 'uuid';
import { BaseApiUrl } from '../../config';
import { languageModeAtom, projectNameAtom } from '../../../store/AppState';
import FileUpload from './FileUpload';
import { fileUploadParentPathAtom, showFileUploadDialogAtom } from './store';
import { fileTabsAtom, IfileTab } from '../../../store/TabState';

interface IContent {
  id: string;
  type: string;
  path: string;
  name: string;
  content: IContent[];
}

interface FileBrowserProps {
  display: string;
  reloadCount: number;
}

export default function FileBrowser({ display, reloadCount }: FileBrowserProps) {
  const [contents, setContents] = useState<IContent[]>([]);
  const [cwd] = useState<string>('');
  const [projectName] = useAtom(projectNameAtom);
  const [showFileUploader] = useAtom(showFileUploadDialogAtom);
  const [fileTabsState, setFileTabsState] = useAtom(fileTabsAtom);
  const [, setLanguageMode] = useAtom(languageModeAtom);

  const handleTabActivate = (name: string, path: string, type: string, kernelspec: string) => {
    const updatedFileTabs = { ...fileTabsState };
    const fileTabData: IfileTab = {
      type,
      path,
      name,
      extension: getFileExtension(name),
      active: true,
      load_required: true,
      kernelspec: kernelspec,
    };

    Object.keys(updatedFileTabs).forEach((key) => {
      updatedFileTabs[key] = {
        ...updatedFileTabs[key],
        active: false,
        load_required: false,
      };
    });
    if (updatedFileTabs[path]) {
      updatedFileTabs[path] = { ...updatedFileTabs[path], active: true };
    } else {
      updatedFileTabs[path] = fileTabData;
    }
    if (updatedFileTabs[path].extension) {
      setLanguageMode(updatedFileTabs[path].extension);
    }
    setFileTabsState(updatedFileTabs);
  };

  const FetchData = useCallback(async () => {
    try {
      const res = await fetch(BaseApiUrl + '/api/contents', {
        method: 'POST',
        body: JSON.stringify({ path: cwd }),
      });
      const resJson = await res.json();

      const updatedContent = resJson.content.map((item) => ({
        ...item,
        id: uuidv4(),
      }));

      setContents(updatedContent);
    } catch (error) {
      console.error('Error fetching data:', error);
    }
  }, [cwd, setContents]);

  const handleFileClick = (name: string, path: string, type: string) => {
    handleTabActivate(name, path, type, 'default');
  };

  const createNewFile = async () => {
    await fetch(BaseApiUrl + '/api/contents/create', {
      method: 'POST',
      body: JSON.stringify({ parent_dir: '', type: 'file' }),
    });
    FetchData();
  };

  const createNewDirectory = async () => {
    await fetch(BaseApiUrl + '/api/contents/create', {
      method: 'POST',
      body: JSON.stringify({ type: 'directory' }),
    });
    FetchData();
  };

  useEffect(() => {
    FetchData();
  }, [FetchData, reloadCount]);

  return (
    <div className={display}>
      <div className="nav-content">
        <div className="content-head">
          <div>FILE EXPLORER</div>
        </div>
        <div className="projectBanner">
          <div className="projectName">{projectName}</div>
          <div className="projectButtons">
            <button className="editor-button" onClick={createNewFile}>
              <img src="./images/editor/feather-file-plus.svg" alt="" />
            </button>
            <button className="editor-button" onClick={createNewDirectory}>
              <img src="./images/editor/feather-folder-plus.svg" alt="" />
            </button>
          </div>
        </div>
        <div className="content-inner">
          <ul className="file-list list-unstyled noborder-list">
            {contents.map((content, index) =>
              content.type === 'directory' ? (
                <DirectoryItem
                  key={content.id}
                  parentDir={cwd}
                  data={content}
                  handleTabActivate={handleTabActivate}
                />
              ) : (
                <FileItem
                  key={content.id}
                  parentDir={cwd}
                  content={content}
                  handleFileClick={handleFileClick}
                />
              )
            )}
          </ul>
        </div>
      </div>
      {showFileUploader && <FileUpload />}
    </div>
  );
}

interface IFileItemProps {
  key: string;
  parentDir: string;
  content: IContent;
  handleFileClick: (name: string, path: string, type: string, kernelspec: string) => void;
}

const FileItem = ({ parentDir, content, handleFileClick }: IFileItemProps) => {
  const getIconToLoad = (fileName) => {
    const extension = getFileExtension(fileName);
    const iconMap: { [key: string]: string } = {
      c: './images/editor/c-icon.svg',
      cpp: './images/editor/cpp-icon.svg',
      go: './images/editor/go-icon.svg',
      mod: './images/editor/go-icon.svg',
      sum: './images/editor/go-icon.svg',
      py: './images/editor/py-icon.svg',
      ipynb: './images/editor/jupyter-icon.svg',
      java: './images/editor/java-icon.svg',
      class: './images/editor/java-icon.svg',
      js: './images/editor/js-icon.svg',
      json: './images/editor/json-icon.svg',
      png: './images/editor/image-icon.svg',
      ts: './images/editor/ts-icon.svg',
      tsx: './images/editor/react-icon.svg',
      jsx: './images/editor/react-icon.svg',
      html: './images/editor/html-icon.svg',
      css: './images/editor/go-icon.svg',
      sass: './images/editor/go-icon.svg',
      scss: './images/editor/go-icon.svg',
      svg: './images/editor/image-icon.svg',
      md: './images/editor/md-icon.svg',
      markdown: './images/editor/md-icon.svg',
      txt: './images/editor/txt-icon.svg',
      gitignore: './images/editor/git-icon.svg',
    };
    const icon = extension != null ? iconMap[extension] : './images/editor/unknown-file-icon.svg';
    return icon != null ? icon : './images/editor/unknown-file-icon.svg';
  };
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
    await fetch(BaseApiUrl + '/api/contents/rename', {
      method: 'POST',
      body: JSON.stringify({
        parent_dir: parentDir,
        old_name: contentName,
        new_name: text,
      }),
    });
    setContentName(text);
    setIcon(getIconToLoad(text));
    setIsEditing(false);
  };

  const deleteContent = async () => {
    await fetch(BaseApiUrl + '/api/contents', {
      method: 'DELETE',
      body: JSON.stringify({ path: getPath() }),
    });
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
      handleFileClick(name, getPath(), type, 'default');
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

interface IDirectoryItemProps {
  key: string;
  parentDir: string;
  data: IContent;
  handleTabActivate: (name: string, path: string, type: string, kernelspec: string) => void;
}

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

  const handleDirectoryClick = async (path: string) => {
    setIsCollapsed(!isCollapsed);
    const res = await fetch(BaseApiUrl + '/api/contents?type=notebook&hash=0', {
      method: 'POST',
      body: JSON.stringify({ path }),
    });
    const resJson = await res.json();
    resJson.content.forEach((item) => {
      item.id = uuidv4();
    });
    setContent(resJson);
  };

  const createNewFile = async (path: string, contentType: string) => {
    await fetch(BaseApiUrl + '/api/contents/create', {
      method: 'POST',
      body: JSON.stringify({ parent_dir: path, type: contentType }),
    });

    const res = await fetch(BaseApiUrl + '/api/contents?type=notebook&hash=0', {
      method: 'POST',
      body: JSON.stringify({ path }),
    });
    const resJson = await res.json();
    resJson.content.forEach((item) => {
      item.id = uuidv4();
    });
    setContent(resJson);
  };

  const renameContent = async () => {
    // check if the name is empty
    await fetch(BaseApiUrl + '/api/contents/rename', {
      method: 'POST',
      body: JSON.stringify({
        parent_dir: parentDir,
        old_name: contentName,
        new_name: text,
      }),
    });
    setContentName(text);
    setIsEditing(false);
  };

  const deleteContent = async (path) => {
    await fetch(BaseApiUrl + '/api/contents', {
      method: 'DELETE',
      body: JSON.stringify({ path: path }),
    });
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
