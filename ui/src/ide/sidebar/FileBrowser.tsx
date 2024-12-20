import React, { useEffect, useState } from 'react';
import { BaseApiUrl } from '../config';
import ContextMenu from './ContextMenu';
import getFileExtension from '../utils';
import { useAtom } from 'jotai';
import { userNameAtom } from '../../store/AppState';
import { v4 as uuidv4 } from 'uuid';


interface IContent {
  id: string;
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
  const [cwd] = useState<string>('');
  const [projectName, setProjectName] = useState('')
  const [userName, setUserName] = useAtom(userNameAtom)

  const FetchData = async () => {
    const res = await fetch(BaseApiUrl + '/api/contents?type=notebook&hash=0', {
      method: 'POST',
      body: JSON.stringify({ path: cwd }),
    });
    const resJson = await res.json();
    resJson.content.forEach((item) => {
        item.id = uuidv4(); 
    });
    setContents(resJson.content);

    const res2 = await fetch(BaseApiUrl + '/api/info');
    const resJson2 = await res2.json();
    setProjectName(resJson2.project.toUpperCase());
    setUserName(resJson2.username)

  };

  const handleFileClick = (name: string, path: string, type: string) => {
    sendDataToParent(name, path, type);
  };

  const createNewFile = async () => {
    await fetch(BaseApiUrl + '/api/contents/create', {
      method: 'POST',
      body: JSON.stringify({ parent_dir: "", type: 'file' }),
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
  }, []);

  return (
    <div className={display}>
      <div className='nav-content'>
        <div className='content-head'>
          <div>FILE EXPLORER</div>
        </div>
        <div className='projectName'>
          <div>{projectName}</div>
          <div className='projectButtons'>
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
                  key={content.id}
                  data={content}
                  sendDataToParent={sendDataToParent}
                />
              ) : (
                <FileItem
                  parentDir={cwd}
                  key={content.id}
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

const FileItem = (
  { parentDir, content, handleFileClick }: {
    parentDir: string; content: IContent;
    handleFileClick: (name: string, path: string, type: string) => void,
  }) => {
  const getIconToLoad = (fileName) => {
    const extension = getFileExtension(fileName);
    const iconMap: { [key: string]: string } = {
      go: './images/editor/go-icon.svg',
      mod: './images/editor/go-icon.svg',
      sum: './images/editor/go-icon.svg',
      py: './images/editor/py-icon.svg',
      ipynb: './images/editor/py-icon.svg',
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
      gitignore: './images/editor/git-icon.svg',
    };
    return extension != null ? iconMap[extension] : './images/editor/go-icon.svg';
  };
  const [isEditing, setIsEditing] = useState(false);
  const [contentName, setContentName] = useState(content.name);
  const [text, setText] = useState(content.name);
  const [menuPosition, setMenuPosition] = useState<{ xPos: number; yPos: number } | null>(null);
  const [isMenuVisible, setIsMenuVisible] = useState(false);
  const [icon, setIcon] = useState(getIconToLoad(content.name))
  const [isDeleted, setIsDeleted] = useState(false)

  const renameContent = async () => {
    setIsEditing(false)
    await fetch(BaseApiUrl + '/api/contents/rename', {
      method: 'POST',
      body: JSON.stringify({ parent_dir: parentDir, old_name: contentName, new_name: text }),
    });
    setContentName(text)
    setIcon(getIconToLoad(text))
  };

  const deleteContent = async () => {
    await fetch(BaseApiUrl + '/api/contents', {
      method: 'DELETE',
      body: JSON.stringify({ path: getPath() }),
    });
    setIsDeleted(true)
  };

  const menuItems = [
    {
      label: 'Rename',
      action: (path: string) => {
        // e.stopPropagation(); // Stop the click event from propagating
        setIsEditing(true);
      }
    },
    {
      label: 'Delete',
      action: (path: string) => {
        // e.stopPropagation(); // Stop the click event from propagating
        deleteContent()

      }
    },
  ];




  const handleRightClick = (e: React.MouseEvent, path: string) => {
    e.preventDefault();
    setMenuPosition({ xPos: e.pageX, yPos: e.pageY });
    setIsMenuVisible(true);
  };

  const getPath = () =>{
    if (parentDir === ""){
      return text
    }else{
      return parentDir + "/" + text
    }
  }

  const handleClick = (name: string, path: string, type: string) => {
    if (!isMenuVisible) {
      handleFileClick(name, getPath(), type)
    }
  }

  if (isDeleted){
    return <></>
  }

  return (
    <li className='fileItem'>
      <a
        onClick={() => handleClick(text, content.path, content.type)}
        onContextMenu={(e) => handleRightClick(e, content.path)}
      >
        <img src={icon} alt='' />
        {isEditing ? (
          <input
            type='text'
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

const DirectoryItem = ({ data, sendDataToParent }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [content, setContent] = useState(data)
  const [text, setText] = useState(data.name);
  const [menuPosition, setMenuPosition] = useState<{ xPos: number; yPos: number } | null>(null);
  const [isMenuVisible, setIsMenuVisible] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isDeleted, setIsDeleted] = useState(false)

  const handleDirectoryClick = async (path: string) => {
    setIsCollapsed(!isCollapsed)
    console.log("handleDirectoryClick")
    const res = await fetch(BaseApiUrl + '/api/contents?type=notebook&hash=0', {
      method: 'POST',
      body: JSON.stringify({ path }),
    });
    const resJson = await res.json();
    resJson.content.forEach((item) => {
        item.id = uuidv4(); 
    });
    setContent(resJson)
  };

  const createNewFile = async (path: string, contentType: string) => {
    console.log("add file")
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
    setContent(resJson)
  };

  const deleteContent = async (path) => {
    await fetch(BaseApiUrl + '/api/contents', {
      method: 'DELETE',
      body: JSON.stringify({ path: path }),
    });
    setIsDeleted(true)
  };

  const menuItems = [
    { label: 'Rename', action: () => setIsEditing(true) },
    { label: 'Add file', action: (path: string) => createNewFile(path, "file") },
    { label: 'Add Notebook', action: (path: string) => createNewFile(path, "notebook") },
    { label: 'Add Folder', action: (path: string) => createNewFile(path, "directory") },
    { label: 'Delete Folder', action: (path: string) => deleteContent(path) }
  ];

  const handleRightClick = (e: React.MouseEvent, path: string) => {
    e.preventDefault();
    setMenuPosition({ xPos: e.pageX, yPos: e.pageY });
    setIsMenuVisible(true);
  };

  if(isDeleted){
    return <></>
  }

  return (
    <li className='fileItem'>
      <a onContextMenu={(e) => handleRightClick(e, data.path)} onClick={() => handleDirectoryClick(data.path)}>
        <img className='directoryIcon' src='./images/editor/directory.svg' alt='' />
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
      <ul className='file-list list-unstyled'>
        {isCollapsed && content.content !== null && content.content.map((content, index) => (
          content.type === 'directory' ? (
            <DirectoryItem key={content.id}
              sendDataToParent={sendDataToParent}
              data={content} />
          ) : (
            <FileItem parentDir={data.name} key={content.id} content={content} handleFileClick={sendDataToParent} />
          )
        ))}
      </ul>
    </li>
  );
};
