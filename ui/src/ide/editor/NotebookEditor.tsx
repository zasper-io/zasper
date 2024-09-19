
import React, { useEffect, useState } from 'react';

import CodeMirror from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { toast, ToastContainer } from 'react-toastify';
import { ReactTerminal } from 'react-terminal';
import { v4 as uuidv4 } from 'uuid';
import Markdown from 'react-markdown';
import rehypeRaw from 'rehype-raw'

import './NotebookEditor.scss'


import { w3cwebsocket as W3CWebSocket } from "websocket";


export default function NotebookEditor(props) {
    interface ICell {
        execution_count: number,
        source: string
    }
    interface IFileContents {
        cells: ICell[]
    }
    const [fileContents, setFileContents] = useState<IFileContents>({ cells: [] });
    const [blankCell, setBlankCell] = useState<ICell>({execution_count: 0, source:""});

    const [client, setClient] = useState<IClient>({ send: () => { } });

    interface IKernel {
        name: string,
        id: string
    }
    const [kernel, setKernel] = useState<IKernel>({ name: "", id: "" });

    interface ISession {
        id: string
    }
    const [session, setSession] = useState<ISession>({ id: '' });


    const FetchFileData = async (path) => {
        const res = await fetch("http://localhost:8888/api/contents/" + path);
        const resJson = await res.json();
        setFileContents(resJson['content']);
        console.log(resJson['content']);

    };

    useEffect(() => {
        if(props.data.load_required == true) {
            FetchFileData(props.data.name);
        }
        // startASession()
        // listKernels();
        // listAllSessions();

    }, [])

    const generateOutput = (data) => {
        if("outputs" in data){
            if (typeof (data.outputs[0]) !== "undefined") {
                // console.log(data.outputs[0]);
                if (data.outputs[0].hasOwnProperty('text')) {
                    return <pre>{data.outputs[0].text}</pre>
                }
                if (data.outputs[0].hasOwnProperty('data')) {
                    if (data.outputs[0].data.hasOwnProperty('text/html')) {

                    }
                    if (data.outputs[0].data.hasOwnProperty('image/png')){
                        let blob = "data:image/png;base64," + (data.outputs[0].data['image/png'])
                        return(
                            <div>
                                <img src={blob}/>
                            </div>
                        )
                    }
                    return (

                        <div>
                            <pre>{data.outputs[0].data['text/plain']}</pre>
                            <div dangerouslySetInnerHTML={{ __html: data.outputs[0].data['text/html'] }} />
                        </div>
                    )
                    
                }
            }

            return JSON.stringify(data.outputs[0]);
        }
    }


    interface IClient {
        send: any
    }

    const listAllKernelSpecs = () => {
        // Simple GET request using fetch
        fetch('http://localhost:8888/api/kernelspecs')
            .then(response => response.json())
            .then(
                (data) => {
                    console.log("data");
                    console.log(data);
                },
                (error) => {
                    console.log("error");
                }

            );
    }

    const listKernels = () => {
        // Simple GET request using fetch
        fetch('http://localhost:8888/api/kernels')
            .then(response => response.json())
            .then(
                (data) => {
                    console.log("kernels running");
                    console.log(data);
                    if(data.lenghth = 0){
                        startAKernel();
                    }

                },
                (error) => {
                    console.log("error");
                }

            );
    }

    const startAKernel = () => {
        // Simple GET request using fetch
        console.log("Starting a kernel");
        if (kernel.name === "") {
            fetch('http://localhost:8888/api/kernels', {
                method: 'POST'
            })
                .then(response => response.json())
                .then(
                    (data) => {
                        console.log("kernels running");
                        console.log(data);
                        setKernel(data)
                    },
                    (error) => {
                        console.log("error");
                    }

                );

        } else {
            console.log("All ready started a kernel");
            console.log(kernel)
        }

    }

    const listAllSessions = () => {
        // Simple GET request using fetch
        fetch('http://localhost:8888/api/sessions')
            .then(response => response.json())
            .then(
                (data) => {
                    console.log("data");
                    console.log(data);
                    if(data.lenghth === 0){
                        startASession();
                    }
                },
                (error) => {
                    console.log("error");
                }

            );
    }


    const startASession = () => {
        // Simple GET request using fetch
        let a = {
            path: "Untitled1.ipynb",
            name: "Untitled1.ipynb",
            type: "notebook",
            kernel: kernel,
            notebook: { path: 'Untitled1.ipynb', name: 'Untitled1.ipynb' }
        }
        console.log(a);
        console.log("Starting a session");
        if (session.id === "") {
            if (kernel != null) {
                fetch('http://localhost:8888/api/sessions', {
                    method: 'POST',
                    body: JSON.stringify({
                        path: "Untitled1.ipynb",
                        name: "Untitled1.ipynb",
                        type: "notebook",
                        kernel: kernel,
                        notebook: { path: 'Untitled1.ipynb', name: 'Untitled1.ipynb' }
                    })

                })
                    .then(response => response.json())
                    .then(
                        (data) => {
                            console.log("sessions running");
                            console.log(data);
                            setSession(data)
                        },
                        (error) => {
                            console.log("error");
                        }

                    );

            } else {
                console.log("No kernel running. Start a kernel first!");
            }
        } else {
            console.log(session);
        }

    }


    const startWebSocket = () => {


        var client1 = new W3CWebSocket("ws://localhost:8888/api/kernels/" + kernel.id + "/channels?session_id=" + session.id);
        // var client1 = new W3CWebSocket("ws://localhost:8888/ws");

        client1.onopen = () => {
            console.log('WebSocket Client Connected');
        };
        client1.onmessage = (message) => {
            message = JSON.parse(message.data);
            if (message.channel === "iopub") {
                console.log("IOPub => ", message);
                if (message.msg_type === 'execute_result') {
                    console.log(message.content.data);
                    toast(message.content.data["text/plain"]);
                    toast(message.content.data["text/html"]);
                }
                if (message.msg_type === 'stream') {
                    console.log(message.content.text);
                    toast(message.content.text);
                    toast(message.content.text);
                }
            }
            if (message.channel === "shell") {
                console.log("Shell => ", message);
            }
        };
        client1.onclose = () => {
            console.log('disconnected');
        }
        setClient(client1);

    }
    interface IHeader {
        msg_id: string, // typically UUID, must be unique per message
        session: string, // typically UUID, should be unique per session
        username: string,
        // ISO 8601 timestamp for when the message is created
        date: string,
        //  All recognized message type strings are listed below.
        msg_type: string,
        // the message protocol version
        version: string,
    }

    interface IMetadata {

    }

    interface IContent {

    }

    interface Imessage {
        header: IHeader,
        parent_header: IHeader,
        metadata: IMetadata,
        content: IContent,
        buffers: string[],
    }

    const getTimeStamp = () => {
        const today = new Date();
        return today.toISOString();
    }

    const sendAMessage = () => {
        let message = JSON.stringify({
            "buffers": [],
            "channel": "shell",
            "content": {
                "silent": false,
                "store_history": true,
                "user_expressions": {},
                "allow_stdin": true,
                "stop_on_error": true,
                "code": "1200*3600"
            },
            "header": {
                "date": getTimeStamp(),
                "msg_id": uuidv4(),
                "msg_type": "execute_request",
                "session": session.id,
                "username": "",
                "version": "5.2"
            },
            "metadata": {
                "deletedCells": [],
                "recordTiming": false,
                "cellId": "1cb16896-03e7-480c-aa2b-f1ba6bb1b56d"
            },
            "parent_header": {}
        })
        console.log("Sending message", message);
        client.send(message);
    }

    const submitCell = (source: string) => {
        toast(source);
        let message = JSON.stringify({
            "buffers": [],
            "channel": "shell",
            "content": {
                "silent": false,
                "store_history": true,
                "user_expressions": {},
                "allow_stdin": true,
                "stop_on_error": true,
                "code": source
            },
            "header": {
                "date": getTimeStamp(),
                "msg_id": uuidv4(),
                "msg_type": "execute_request",
                "session": session.id,
                "username": "",
                "version": "5.2"
            },
            "metadata": {
                "deletedCells": [],
                "recordTiming": false,
                "cellId": "1cb16896-03e7-480c-aa2b-f1ba6bb1b56d"
            },
            "parent_header": {}
        })
        console.log("Sending message", message);
        client.send(message);
    }

    const saveFile = async () => {
        let path = "demo.ipynb";
        console.log(fileContents);
        alert("Saving file")
        const res = await fetch("http://localhost:8888/api/contents/demo.ipynb", {
            method: 'PUT',
            body: JSON.stringify({
                content: JSON.stringify(fileContents),
                type: 'file',
                format: 'text'
            })
        });
    }


    return (
        <div className="tab-content">
        <div className={props.data.display} id="profile" role="tabpanel" aria-labelledby="profile-tab">
            <div className="text-editor-tool">
                <button type='button' className='editor-button' onClick={saveFile}><i className="fas fa-save"></i></button>
                <button type='button' className='editor-button'><i className="fas fa-cut"></i></button>
                <button type='button' className='editor-button'><i className="fas fa-copy"></i></button>
                <button type='button' className='editor-button'><i className="fas fa-plus"></i></button>
                <button type='button' className='editor-button'><i className="fas fa-check-square"></i></button>
                <button type='button' className='editor-button'><i className="fas fa-play"></i></button>
                <button type='button' className='editor-button'><i className="fas fa-square"></i></button>
                <button type='button' className='editor-button'><i className="fas fa-redo"></i></button>
                <button type='button' className='editor-button'><i className="fas fa-forward"></i></button>
                <div className="ms-auto">Python [conda env:default]*</div>
            </div>
            <ToastContainer />
            <div>
                <button type='button' onClick={saveFile}>Save file</button>
                <button type='button' onClick={listKernels}>ListKernels</button>
                <button type='button' onClick={startAKernel}>StartAKernel</button>
                <button type='button' onClick={startASession}>StartASession</button>
                <button type='button' onClick={listAllSessions}>ListAllSessions</button>
                <button type='button'>Button2</button>
                <button type='button' onClick={startWebSocket}>StartWebSocket</button>
                <button type='button' onClick={sendAMessage}>SendAMessage</button>
            </div>
            <div className="editor-body">
                {
                    fileContents.cells.map((cell, index) => 
                            <Cell key={index} cell={cell} generateOutput={generateOutput}/>
                    )
                }

            </div>
        </div>
        </div>
    );
}

function Cell(props){
    let cell = props.cell;
    if(cell.cell_type==="markdown"){
        return(
            <Markdown rehypePlugins={[rehypeRaw]}>{cell.source}</Markdown>
        )
    }
    return (
        <div className="single-line">
            
            <div className="serial-no">[{cell.execution_count}]:</div>
            <div className="inner-content">
                <CodeMirror
                    value={cell.source}
                    height="auto"
                    width='100%'
                    extensions={[python()]}
                    onChange={(value) => {
                        cell.source = value;
                    }}
                />
                <div>
                    <button type='button' onClick={() => props.submitCell(cell.source)}> Run</button>
                </div>

                <div className="inner-text">
                    {props.generateOutput(cell)}
                </div>
            </div>
        </div>
    )
}