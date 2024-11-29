
import React from 'react';

import { useAtom } from 'jotai';
import { settingsAtom } from '../../store/Settings';

export default function StatusBar () {

    const [settings, setSettings] = useAtom(settingsAtom)
    return (
    <div className='statusBar'>
        Spaces: {settings.tabSize} | {settings.encoding} | {settings.language} | Ln {settings.activeLine}, Col {settings.activeColumn}
    </div>
    )
}
