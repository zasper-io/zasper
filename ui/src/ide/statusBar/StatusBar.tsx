
import React from 'react';

import { useAtom } from 'jotai';

import './StatusBar.scss'
import { columnPositionAtom, encodingAtom, eolSequenceAtom, indentationModeAtom, indentationSizeAtom, languageModeAtom, linePositionAtom } from '../../store/AppState';

export default function StatusBar () {

    const [indentationMode] = useAtom(indentationModeAtom)
    const [indentationSize] = useAtom(indentationSizeAtom)
    const [languageMode] = useAtom(languageModeAtom)
    const [linePosition] = useAtom(linePositionAtom)
    const [columnPosition] = useAtom(columnPositionAtom)
    const [encoding] = useAtom(encodingAtom)
    const [eolSequence] = useAtom(eolSequenceAtom)

    
    return (
    <div className='statusBar'>
        <div className='leftStatus'>
            master
        </div>
        <div className='rightStatus'>
            <span className='statusItem'>Ln {linePosition}, Col {columnPosition}</span>
            <span className='statusItem'>{indentationMode}: {indentationSize}</span> 
            <span className='statusItem'>{encoding}</span>
            <span className='statusItem'>{eolSequence}</span>
            <span className='statusItem'>{languageMode}</span>
        </div>
    </div>
    )
}
