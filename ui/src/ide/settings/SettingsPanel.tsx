import React, { useState, useEffect } from 'react';
import { useAtom } from 'jotai';
import { settingsAtom } from '../../store/Settings';

export default function SettingsPanel({sendDataToParent, display}) {

    const [settings, setSettings] = useAtom(settingsAtom);

    return (

        <div className={display}>
            <div className="nav-content">
                <div className="content-head">
                    <h6>Settings</h6>
                    <div>
                    </div>
                </div>
                <div className="content-inner">
                    <ul className="file-list list-unstyled">
                        <li>Tab Size: {settings.tabSize}</li>
                    </ul>
                </div>
            </div>
        </div>
    )
}
