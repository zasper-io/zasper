import React, { useEffect, useState } from 'react';
import { BaseApiUrl } from '../config';
import ContextMenu from './ContextMenu';


interface MenuItem {
    label: string;
    action: () => void;
}

export default function FileBrowser({ sendDataToParent }) {

    const [menuPosition, setMenuPosition] = useState<{ xPos: number; yPos: number } | null>(null);
    const [isMenuVisible, setIsMenuVisible] = useState<boolean>(false);
  
    const handleRightClick = (event: React.MouseEvent) => {
      event.preventDefault();
      setMenuPosition({ xPos: event.pageX, yPos: event.pageY });
      setIsMenuVisible(true);
    };
  
    const handleCloseMenu = () => {
      setIsMenuVisible(false);
    };

    interface IContent {
        type: string,
        path: string,
        name: string
    }

    const [contents, setContents] = useState<IContent[]>([]);

    const [cwd, setCwd] = useState<String>("");


    const directoryRightClickHandler = (e, hey) => {
        e.preventDefault(); // prevent the default behaviour when right clicked
        console.log("Right Click");

        setMenuPosition({ xPos: e.pageX, yPos: e.pageY });
        setIsMenuVisible(true);
    }


    const menuItems = [
        { label: 'Rename', action: () => alert('Rename') },
        { label: 'Delete', action: () => alert('Delete') },
    ];


    const FetchData = async () => {
        const res = await fetch(BaseApiUrl + "/api/contents?type=notebook&hash=0", {
            method: 'POST',

            body: JSON.stringify({
                path: cwd
            })
        });
        const resJson = await res.json();
        setContents(resJson['content']);
    };

    const handleFileClick = async (path: string, type: string) => {
        if (cwd != "") {
            path = cwd + "/" + path
        }
        sendDataToParent(path, type);

    };

    const handleDirectoryClick = async (path: string, type: string) => {
        let nCwd = cwd
        if (cwd === "") {
            nCwd = path
        } else {
            nCwd = cwd + "/" + path
        }
        setCwd(nCwd)
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
        const res = await fetch(BaseApiUrl + "/api/contents/" + path, {
            method: 'POST',
            body: JSON.stringify({
                type: 'directory'
            })
        });
        FetchData();
    }

    useEffect(() => {
        FetchData();
    }, [cwd])

    return (
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
                            return <DirectoryItem index={index} 
                            directoryRightClickHandler={directoryRightClickHandler}
                            handleDirectoryClick = {handleDirectoryClick}
                            content = {content}/>
                        } else {
                            return <FileItem index={index} 
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
                    onClose={handleCloseMenu}
                    />
                )}
            </div>
        </div>
    )
}

function FileItem({index , directoryRightClickHandler, handleFileClick, content}){
    return <li key={index}><a onContextMenu={(e) => directoryRightClickHandler(e, "hi")} onClick={() => handleFileClick(content.path, content.type)}><img src="./images/editor/py-icon.svg" alt="" /> {content.name}<button className='editor-button-right'><img src="./images/editor/ionic-md-more.svg" alt="" /></button></a></li>
}

function DirectoryItem({index , directoryRightClickHandler, handleDirectoryClick, content}){
    return <li key={index}><a onContextMenu={(e) => directoryRightClickHandler(e, "hi")} onClick={() => handleDirectoryClick(content.path, content.type)}><img src="./images/editor/directory.svg" alt="" /> {content.name}<button className='editor-button-right'><img src="./images/editor/ionic-md-more.svg" alt="" /></button></a></li>
                        
}