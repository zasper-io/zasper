import React, { useEffect, useState } from 'react';
import { BaseApiUrl } from '../config';
import ContextMenu from './ContextMenu';
import getFileExtension from '../utils';


interface IContent {
  type: string;
  path: string;
  name: string;
  content: IContent[];
}

interface FileBrowserProps {
  sendDataToParent: (name: string, path: string, type: string) => void;
  display: string;
}

export default function FileBrowser({ sendDataToParent, display }: FileBrowserProps) {
  const [contents, setContents] = useState<IContent[]>([]);
  const [cwd, setCwd] = useState<string>('');
  const [fileContents, setFileContents] = useState('')

  const FetchData = async () => {
    const res = await fetch(BaseApiUrl + '/api/contents?type=notebook&hash=0', {
      method: 'POST',
      body: JSON.stringify({ path: cwd }),
    });
    const resJson = await res.json();
    setContents(resJson.content);
  };

  const handleFileClick = (name: string, path: string, type: string) => {
    sendDataToParent(name, path, type);
  };

  const createNewFile = async () => {
    await fetch(BaseApiUrl + '/api/contents/create', {
      method: 'POST',
      body: JSON.stringify({ ext: '.py', type: 'file' }),
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
  }, [cwd]);

  return (
    <div className={display}>
      <div className='nav-content'>
        <div className='content-head'>
          <h6>{cwd}</h6>
          <h6>Files</h6>
          <div>
            <button className='editor-button' onClick={createNewFile}>
              <img src='./images/editor/feather-file-plus.svg' alt='' />
            </button>
            <button className='editor-button' onClick={createNewDirectory}>
              <img src='./images/editor/feather-folder-plus.svg' alt='' />
            </button>
          </div>
        </div>
        <div className='content-inner'>
          <ul className='file-list list-unstyled'>
            {contents.map((content, index) => (
              content.type === 'directory' ? (
                <DirectoryItem
                  key={index}
                  data={content}
                  sendDataToParent={sendDataToParent}
                />
              ) : (
                <FileItem
                  key={index}
                  content={content}
                  handleFileClick={handleFileClick}
                />
              )
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

const FileItem = ({ content, handleFileClick }: { content: IContent; handleFileClick: (name: string, path: string, type: string) => void }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [text, setText] = useState(content.name);

  const getIconToLoad = () => {
    const extension = getFileExtension(content.name);
    const iconMap: { [key: string]: string } = {
      go: './images/editor/go-icon.svg',
      mod: './images/editor/go-icon.svg',
      py: './images/editor/py-icon.svg',
      ipynb: './images/editor/py-icon.svg',
      js: './images/editor/js-icon.svg',
      json: './images/editor/json-icon.svg',
      ts: './images/editor/ts-icon.svg',
      tsx: './images/editor/react-icon.svg',
      jsx: './images/editor/react-icon.svg',
      html: './images/editor/html-icon.svg',
      css: './images/editor/go-icon.svg',
      sass: './images/editor/go-icon.svg',
      scss: './images/editor/go-icon.svg',
      md: './images/editor/md-icon.svg',
      markdown: './images/editor/md-icon.svg',
      gitignore: './images/editor/git-icon.svg',
    };
    return extension != null ? iconMap[extension] : './images/editor/go-icon.svg';
  };

  return (
    <li className='fileItem'>
      <a
        onClick={() => handleFileClick(content.name, content.path, content.type)}
        onContextMenu={(e) => e.preventDefault()}
      >
        <img src={getIconToLoad()} alt='' />
        {isEditing ? (
          <input
            type='text'
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => setIsEditing(false)}
            onKeyDown={(e) => e.key === 'Enter' && setIsEditing(false)}
            autoFocus
          />
        ) : (
          <span onClick={() => setIsEditing(true)}>{text}</span>
        )}
      </a>
    </li>
  );
};

const DirectoryItem = ({data, sendDataToParent }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [content, setContent] = useState(data)
  const [text, setText] = useState(data.name);
  const [menuPosition, setMenuPosition] = useState<{ xPos: number; yPos: number } | null>(null);
  const [isMenuVisible, setIsMenuVisible] = useState(false);

  const handleDirectoryClick = async (path: string) => {
    console.log("handleDirectoryClick")
    const res = await fetch(BaseApiUrl + '/api/contents?type=notebook&hash=0', {
      method: 'POST',
      body: JSON.stringify({ path }),
    });
    const resJson = await res.json();
    // sendDataToParent(resJson.name, resJson.path, resJson.type);
    setContent(resJson)
  };

  const menuItems = [
    { label: 'Rename', action: () => setIsEditing(true) },
    // { label: 'Delete', action: async () => await deleteFile(data.path) }
  ];

  const handleRightClick = (e: React.MouseEvent, path: string) => {
    e.preventDefault();
    setMenuPosition({ xPos: e.pageX, yPos: e.pageY });
    setIsMenuVisible(true);
  };

  return (
    <li className='fileItem'>
      <a onContextMenu={(e) => handleRightClick(e, data.path)} onClick={() => handleDirectoryClick(data.path)}>
        <img src='./images/editor/directory.svg' alt='' />
        {isEditing ? (
          <input
            type='text'
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => setIsEditing(false)}
            onKeyDown={(e) => e.key === 'Enter' && setIsEditing(false)}
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
      <ul>
        <ul className='file-list list-unstyled'>
          {content.content !== null &&  content.content.map((content, index) => (
            content.type === 'directory' ? (
              <DirectoryItem key={index} 
                              sendDataToParent={sendDataToParent}
                              data={content} />
            ) : (
              <FileItem key={index} content={content} handleFileClick={sendDataToParent} />
            )
          ))}
        </ul>
      </ul>
    </li>
  );
};
