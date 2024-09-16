
import React, { useEffect, useState } from 'react';

import FileTab from './FileTab';
import LauncherTab from './LauncherTab';
import NbFileTab from './NbFileTab';
import TerminalTab from '../terminal/Terminal';

export default function SuperTab(props) {
    if(props.data.type === "launcher"){
        return <LauncherTab data={props.data} sendDataToParent={props.sendDataToParent}/>
    }
    if(props.data.type === "file"){
        return <FileTab data={props.data} />
    }
    if(props.data.type === "notebook"){
        return <NbFileTab data={props.data} />
    }
    if(props.data.type === "terminal"){
        return <TerminalTab data={props.data} />
    }
    return <></>
}


