import React, { useState, useEffect } from 'react';

export default  function TabIndex(props) {
    let tabs = props.tabs

    const handleTabClick = async (path: string) => {
        props.sendDataToParent(path);
    };

    const handleTabClose = async (e, key: string) =>{
        e.stopPropagation();
        props.sendCloseSignalToParent(key)
    }
    
    return (
        
            <div className="tabHeader">
                <ul className="nav-item nav">
                    {Object.keys(tabs).map((key, index) => 
                        <li key={index} className="nav-item" role="presentation">
                            <button type="button" className="nav-link" onClick={() => handleTabClick(tabs[key].name)} >
                                {tabs[key].name}
                                <span className="editor-button">
                                    <i className="fas fa-times-circle" onClick={(e) => handleTabClose(e, key)}></i>
                                </span>
                            </button>
                        </li>
                    )}
                </ul>
            </div>
    )
}
