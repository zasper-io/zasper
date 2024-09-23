import React, { useEffect, useState } from 'react';
import { BaseApiUrl } from '../config';
import ContextMenu from './ContextMenu';

interface IContent {
    type: string,
    path: string,
    name: string,
    content: IContent[]
}

export default function FileBrowser({ sendDataToParent, display }) {

    const [menuPosition, setMenuPosition] = useState<{ xPos: number; yPos: number } | null>(null);
    const [isMenuVisible, setIsMenuVisible] = useState<boolean>(false);
    const [contextPath, setContextPath] = useState<string>("");
  
    // const handleRightClick = (event: React.MouseEvent, path:string) => {
    //   event.preventDefault();
    //   setMenuPosition({ xPos: event.pageX, yPos: event.pageY });
    //   setContextPath(path)
    //   setIsMenuVisible(true);
    // };
  
    const handleCloseMenu = () => {
      setIsMenuVisible(false);
    };

    

    const [contents, setContents] = useState<IContent[]>([]);

    const [cwd, setCwd] = useState<String>("");


    const directoryRightClickHandler = (e, path: string) => {
        e.preventDefault(); // prevent the default behaviour when right clicked
        console.log("Right Click");

        setMenuPosition({ xPos: e.pageX, yPos: e.pageY });
        setContextPath(path);
        setIsMenuVisible(true);
    }


    const menuItems = [
        { label: 'Rename', action: (contextPath: string) => alert('Rename' + contextPath) },
        { label: 'Delete', action: (contextPath: string) => deleteFile(contextPath) },
    ];


    const FetchData = async () => {
        const res = await fetch(BaseApiUrl + "/api/contents?type=notebook&hash=0", {
            method: 'POST',

            body: JSON.stringify({
                path: cwd
            })
        });
        const resJson = await res.json();
        console.log(resJson)
        setContents(resJson['content']);
    };

    const handleFileClick = async (name: string, path: string, type: string) => {
        sendDataToParent(name, path, type);
    };

    const showNewFileDialog = () => {
        console.log("New file");
    }

    const createNewFile = async () => {
        let path = "abc.py";
        const res = await fetch(BaseApiUrl + "/api/contents/create", {
            method: 'POST',

            body: JSON.stringify({
                ext: '.py',
                type: 'file'
            })
        });
        FetchData();
    }

    const createNewDirectory = async () => {
        let path = "abc.py";
        const res = await fetch(BaseApiUrl + "/api/contents/create" + path, {
            method: 'POST',
            body: JSON.stringify({
                type: 'directory'
            })
        });
        FetchData();
    }


    const renameFile = async (oldPath: string, newPath: string) => {
        const res = await fetch(BaseApiUrl + "/api/contents/untitled", {
            method: 'PATCH',
            body: JSON.stringify({
                old_path: oldPath,
                new_path: newPath
            })
        });
    }

    const deleteFile = async (path: string) => {

        console.log('Deleting file');
        
        const res = await fetch(BaseApiUrl + "/api/contents", {
            method: 'DELETE',
            body: JSON.stringify({
                path : path
            })
        });
    }

    useEffect(() => {
        FetchData();
    }, [cwd])

    return (

        <div className={display}>
            <div className="nav-content">
                <div className="content-head">
                    <h6>{cwd}</h6>
                    <h6>Files</h6>
                    <div>
                        <button className='editor-button' onClick={createNewFile}><img src="./images/editor/feather-file-plus.svg" alt="" /></button>
                        <button className='editor-button' onClick={createNewDirectory}><img src="./images/editor/feather-folder-plus.svg" alt="" /></button>
                    </div>
                </div>
                <div className="content-inner">
                    <ul className="file-list list-unstyled">
                        {contents.map((content, index) => {
                            if (content.type === "directory") {
                                return <DirectoryItem key={index} 
                                directoryRightClickHandler={directoryRightClickHandler}
                                data = {content}
                                sendDataToParent={sendDataToParent}/>
                            } else {
                                return <FileItem key={index} 
                                directoryRightClickHandler={directoryRightClickHandler}
                                handleFileClick = {handleFileClick}
                                content = {content}/>
                            }
                        }
                        )}
                    </ul>
                </div>
                <div>
                    {isMenuVisible && menuPosition && (
                        <ContextMenu
                        xPos={menuPosition.xPos}
                        yPos={menuPosition.yPos}
                        items={menuItems}
                        path={contextPath}
                        onClose={handleCloseMenu}
                        />
                    )}
                </div>
            </div>
        </div>
    )
}

function FileItem({directoryRightClickHandler, handleFileClick, content}){
    return (
        <li className='fileItem'>
            <a onContextMenu={(e) => directoryRightClickHandler(e, content.path)} onClick={() => handleFileClick(content.name, content.path, content.type)}>
                <img src="./images/editor/py-icon.svg" alt="" /> 
                {content.name}
            </a>
        </li>
    )
}

function DirectoryItem({directoryRightClickHandler, data, sendDataToParent}){
    const [content, setContent] = useState<IContent>(data);

    const handleFileClick = async (name: string, path: string, type: string) => {
        sendDataToParent(name, path, type);
    };


    const FetchData = async (path) => {
        const res = await fetch(BaseApiUrl + "/api/contents?type=notebook&hash=0", {
            method: 'POST',

            body: JSON.stringify({
                path: path
            })
        });
        const resJson = await res.json();
        console.log("important =>" ,resJson)
        setContent(resJson);
    };

    const handleDirectoryClick = async (path: string, type: string) => {
        FetchData(path)
    };
    useEffect(() => {
    }, [])

    return (
        <li className='fileItem'>
            <a onContextMenu={(e) => directoryRightClickHandler(e, content.path)} onClick={() => handleDirectoryClick(content.path, content.type)}>
                <img src="./images/editor/directory.svg" alt="" /> 
                {content.name}
            </a>
            <ul>
                <ul className="file-list list-unstyled">
                    {content.content !==null && content.content.map((content, index) => {
                        if (content.type === "directory") {
                            return <DirectoryItem key={index} 
                            sendDataToParent={sendDataToParent}
                            directoryRightClickHandler={directoryRightClickHandler}
                            data = {content}/>
                        } else {
                            return <FileItem key={index} 
                            directoryRightClickHandler={directoryRightClickHandler}
                            handleFileClick = {handleFileClick}
                            content = {content}/>
                        }
                    }
                    )}
                </ul>
            </ul>
        </li>)   
}