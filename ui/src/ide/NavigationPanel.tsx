import React, { useEffect, useState } from 'react';
import ContextMenu from './sidebar/ContextMenu';

const NavigationPanel = () => {

    const [menuPosition, setMenuPosition] = useState<{ xPos: number; yPos: number } | null>(null);
    const [isMenuVisible, setIsMenuVisible] = useState<boolean>(false);

    const menuBarClickHandler = (e) => {
        e.preventDefault(); // prevent the default behaviour when right clicked
        console.log("Left Click");

        setMenuPosition({ xPos: e.pageX, yPos: e.pageY });
        setIsMenuVisible(true);
    }

    const menuItems = [
        { label: 'File', action: () => alert('File') },
        { label: 'Edit', action: () => alert('Edit') },
    ];

    const showGitPanel = () => {
        console.log("showGit Panel")
    }

    const showDebugPanel = () => {
        console.log("showDebug Panel")
    }

    const showSecretsPanel = () => {
        console.log("showSecrets Panel")
    }

    const showSettingsPanel = () => {
        console.log("showSettings Panel")
    }

    const showDatabasePanel = () => {
        console.log("showDatabase Panel")
    }

    const changeActiveKey = () => {
        // setActiveTab('demo');
    }

    const handleCloseMenu = () => {
        setIsMenuVisible(false);
    };
  

    return (
        <div className="navigation-list">
            <button className="editor-button nav-link" onClick={(e) => menuBarClickHandler(e)}><img src="./images/editor/menu-bar.svg" alt="" /></button>
            <button className="editor-button nav-link active" onClick={changeActiveKey}><img src="./images/editor/feather-file-text.svg" alt="" /></button>
            <button className="editor-button nav-link" onClick={showGitPanel}><img src="./images/editor/metro-flow-branch.svg" alt="" /></button>
            <button className="editor-button nav-link"><img src="./images/editor/feather-box.svg" alt="" /></button>
            <button className="editor-button nav-link" onClick={showDebugPanel}><img src="./images/editor/feather-play-circle.svg" alt="" /></button>
            <button className="editor-button nav-link" onClick={showSecretsPanel}><img src="./images/editor/feather-lock.svg" alt="" /></button>
            <button className="editor-button nav-link" onClick={showSettingsPanel}><img src="./images/editor/feather-settings.svg" alt="" /></button>
            <button className="editor-button nav-link" onClick={showDatabasePanel}><img src="./images/editor/feather-database.svg" alt="" /></button>
            <button className="editor-button nav-link"><img src="./images/editor/ionic-ios-checkmark-circle-outline.svg" alt="" /></button>
            <button className="editor-button mt-auto help-icon"><i className="fas fa-question-circle"></i></button>

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
    );
}

export default NavigationPanel;
