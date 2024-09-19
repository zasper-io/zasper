
import NavigationPanel from './NavigationPanel';

import React, { useState, useEffect } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';

import FileBrowser from './sidebar/FileBrowser';
import "./IDE.scss"

import ContentPanel from './editor/ContentPanel';
import TabIndex from './tabs/TabIndex';
import Topbar from './topbar/Topbar';
import getFileExtension from './utils';

interface Ifile {
    type: string,
    path: string,
    name: string,
    display: string
    extension: string | null
    load_required: boolean
}

interface IfileDict{
    [id:string]: Ifile
}

function Lab() {
    const ksfile: Ifile = {
        type: "launcher",
        path: "none",
        name: "Launcher",
        display: "d-block",
        extension: "txt",
        load_required : false
    }

    const ksfileDict: IfileDict = {
       "Launcher": ksfile
    }

    const [dataFromChild, setDataFromChild] = useState<IfileDict>(ksfileDict);

    function handleDataFromChild(name, type) {
        console.log(name, type);
        if(dataFromChild[name] === undefined){
            
            const fileData: Ifile = {
                type: type,
                path: "none",
                name: name,
                extension: getFileExtension(name),
                display: "d-block",
                load_required: true
            }
            
            let updatedDataFromChild: IfileDict =  Object.assign({}, dataFromChild)
            for(let key in updatedDataFromChild){
                updatedDataFromChild[key]['display'] = 'd-none'
                updatedDataFromChild[key]['load_required'] = false
            }
            updatedDataFromChild[name.toString()] = fileData
            console.log(updatedDataFromChild)
            setDataFromChild(updatedDataFromChild)
        }else{
            let updatedDataFromChild: IfileDict =  Object.assign({}, dataFromChild)
            for(let key in updatedDataFromChild){
                updatedDataFromChild[key]['display'] = 'd-none'
                updatedDataFromChild[key]['load_required'] = false
            }
            updatedDataFromChild[name]['display'] = 'd-block'
            setDataFromChild(updatedDataFromChild)
        }
        console.log("state: ", dataFromChild)
    }

    function handlCloseTabSignal(key) {
        console.log("closing key", key)
        let updatedDataFromChild: IfileDict =  Object.assign({}, dataFromChild)
        delete updatedDataFromChild[key]
        setDataFromChild(updatedDataFromChild)
        console.log(dataFromChild)
    }
    
    return (
        <div className='editor'>
            <PanelGroup direction="vertical">
                <Panel defaultSize={5}>
                    <Topbar></Topbar>
                </Panel>
                <Panel defaultSize={93} maxSize={93}>
                        <PanelGroup direction="horizontal">
                            <Panel defaultSize={20} minSize={20}>
                                <div className="navigation">
                                    <NavigationPanel />
                                    <FileBrowser sendDataToParent={handleDataFromChild}/>
                                </div>
                            </Panel>
                            <PanelResizeHandle />
                            <Panel defaultSize={80} minSize={50}>
                                <div className="main-content">
                                    <TabIndex tabs={dataFromChild} sendDataToParent={handleDataFromChild} sendCloseSignalToParent={handlCloseTabSignal}></TabIndex>
                                    <ContentPanel tabs={dataFromChild} sendDataToParent={handleDataFromChild}></ContentPanel>
                                </div>
                                </Panel>
                        </PanelGroup>
                </Panel>
                <Panel maxSize={2}>
                    <div className='statusBar'>
                        Spaces: 4   UTF-8
                    </div>ß
                </Panel>
            </PanelGroup>

            
        </div>
    )
}

export default Lab;