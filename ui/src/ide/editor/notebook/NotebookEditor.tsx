
import React, { useEffect, useState, useRef, useCallback } from 'react'

import { v4 as uuidv4 } from 'uuid'
import 'react-toastify/dist/ReactToastify.css';

import './NotebookEditor.scss'

import { w3cwebsocket as W3CWebSocket } from 'websocket'
import { BaseApiUrl } from '../../config'
import NbButtons from './NbButtons'
import Cell from './Cell'
import { useAtom } from 'jotai';
import { themeAtom } from '../../../store/Settings';

const debugMode = false

interface CodeMirrorRef {
  editor: {
    focus: () => void;
  };
}

export default function NotebookEditor (props) {
  interface ICell {
    cell_type: CellType
    id: string
    execution_count: number
    source: string
    outputs: any
  }
  interface INotebookModel {
    cells: Array<ICell>
    nbformat: number
    nbformat_minor: number
    metadata: INotebookMetadata
  }


  interface INotebookMetadata {
    kernelspec?: IKernelspecMetadata;
    language_info?: ILanguageInfoMetadata;
    orig_nbformat?: number;
  }

  interface IKernelspecMetadata{
    name: string;
    display_name: string;
  }

  interface ILanguageInfoMetadata {
    name: string;
    codemirror_mode?: string;
    file_extension?: string;
    mimetype?: string;
    pygments_lexer?: string;
  }

  type CellType = 'code' | 'markdown' | 'raw' | string;
  

  const notebook = useRef<INotebookModel>(
    { 
                                                    cells: [], 
                                                    nbformat:0, 
                                                    nbformat_minor:0,
                                                    metadata: {}
                                                  })
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [focusedIndex, setFocusedIndex] = useState(0);
  const divRefs = useRef<(HTMLDivElement | null)[]>([]); // Type the refs
  const codeMirrorRefs = useRef<CodeMirrorRef[]>([]); 
  const [theme, setTheme] = useAtom(themeAtom)


  const [client, setClient] = useState<IClient>({ send: () => { } })

  interface IKernel {
    name: string
    id: string
  }
  const [kernel, setKernel] = useState<IKernel>({ name: '', id: '' })

  interface ISession {
    id: string
    kernel: IKernel
  }
  const [session, setSession] = useState<ISession>({ id: '', kernel: {id: '', name: ''} })


  const FetchFileData = async (path) => {
    try{
      const res = await fetch(BaseApiUrl + '/api/contents?type=notebook&hash=0', {
        method: 'POST',

        body: JSON.stringify({
          path
        })
      })
      if (!res.ok) {
        throw new Error('Failed to fetch data');
      }
      const resJson = await res.json()
      resJson.content.cells.forEach(cell => {
        cell.id = uuidv4(); // Add UUID to each cell object
      });
      notebook.current = resJson.content
      console.log("notebook => ", notebook);
      setLoading(false);
    } catch (err: unknown) {
      if (err instanceof Error) {  // Narrow the type of err
        setError(err.message);  // Access err.message safely
      } else {
        setError('An unknown error occurred');
      }
      setLoading(false);  // Ensure loading is set to false
    }
  }

  useEffect(() => {
    if (props.data.load_required == true) {
      FetchFileData(props.data.path)
    }
   
  }, [])



  interface IClient {
    send: any
  }

  const listAllKernelSpecs = () => {
    // Simple GET request using fetch
    fetch(BaseApiUrl + '/api/kernelspecs')
      .then(async response => await response.json())
      .then(
        (data) => {
          console.log('data')
          console.log(data)
        },
        (error) => {
          console.log('error')
        }

      )
  }
 

  const startASession = (path, name, type) => {
    // Simple GET request using fetch
    console.log('Starting a session')
    if (session.id === '') {
      if (kernel != null) {
        fetch(BaseApiUrl + '/api/sessions', {
          method: 'POST',
          body: JSON.stringify({
            path: path,
            name: name,
            type: type,
            kernel,
            notebook: { path: path, name: name }
          })

        })
          .then(async response => await response.json())
          .then(
            (data) => {
              console.log('sessions running')
              console.log(data)
              setSession(data)
            },
            (error) => {
              console.log('error')
            }

          )
      } else {
        console.log('No kernel running. Start a kernel first!')
      }
    } else {
      console.log(session)
    }
  }

  const startWebSocket = () => {
    const client1 = new W3CWebSocket('ws://localhost:8888/api/kernels/' + session.kernel.id + '/channels?session_id=' + session.id)

    client1.onopen = () => {
      console.log('WebSocket Client Connected')
    }
    client1.onmessage = (message) => {
      message = JSON.parse(message.data)
      console.log(message)
      if(message.hasOwnProperty("data")){
        notebook.current.cells[focusedIndex].outputs[0].data['text/plain'] = message.data['text/plain']
        // toast(message.data["text/plain"]);
      }

      if (message.channel === 'iopub') {
        console.log('IOPub => ', message)
        if (message.msg_type === 'execute_result') {
          console.log(message.content.data)
          console.log(message.content.data['text/plain'])
          console.log(message.content.data['text/html'])
         
        }
        if (message.msg_type === 'stream') {
          console.log(message.content.text)
          console.log(message.content.text)
          console.log(message.content.text)
        }
      }
      if (message.channel === 'shell') {
        console.log('Shell => ', message)
      }
    }
    client1.onclose = () => {
      console.log('disconnected')
    }
    setClient(client1)
  }
  interface IHeader {
    msg_id: string // typically UUID, must be unique per message
    session: string // typically UUID, should be unique per session
    username: string
    // ISO 8601 timestamp for when the message is created
    date: string
    //  All recognized message type strings are listed below.
    msg_type: string
    // the message protocol version
    version: string
  }

  interface IMetadata {

  }

  interface IContent {

  }

  interface Imessage {
    header: IHeader
    parent_header: IHeader
    metadata: IMetadata
    content: IContent
    buffers: string[]
  }

  const getTimeStamp = () => {
    const today = new Date()
    return today.toISOString()
  }

  const createExecuteRequestMsg = (code: string) => {
    return {
      silent: false,
      store_history: true,
      user_expressions: {},
      allow_stdin: true,
      stop_on_error: true,
      code: code
    }
  }

  const submitCell = (source: string, cellId: string) => {
    const message = JSON.stringify({
      buffers: [],
      channel: 'shell',
      content: createExecuteRequestMsg(source),
      header: {
        date: getTimeStamp(),
        msg_id: cellId,
        msg_type: 'execute_request',
        session: session.id,
        username: 'prasunanand',
        version: '5.2'
      },
      metadata: {
        deletedCells: [],
        recordTiming: false,
        cellId: '1cb16896-03e7-480c-aa2b-f1ba6bb1b56d'
      },
      parent_header: {}
    })
    console.log('Sending message', message)
    client.send(message)
  }

  const saveFile = async () => {
    const path = 'demo.ipynb'
    console.log(notebook)
    alert('Saving file')
    const res = await fetch('http://localhost:8888/api/contents/demo.ipynb', {
      method: 'PUT',
      body: JSON.stringify({
        content: JSON.stringify(notebook),
        type: 'file',
        format: 'text'
      })
    })
  }

  const addCellUp = async () =>{
    console.log("add cell Up");
    const updatedNotebook = Object.assign({}, notebook)
    notebook.current.cells.push({
      execution_count: 0,
      source: "",
      cell_type: "raw",
      id: uuidv4(),
      outputs: ""
    })

  }

  const addCellDown = async () =>{
    console.log("add cell Down");
    notebook.current.cells.push({
      execution_count: 0,
      source: "",
      cell_type: "raw",
      id: uuidv4(),
      outputs: ""
    })
  }

  const deleteCell = async (index: number) =>{
    console.log("delete cell at index => " + index)
    notebook.current.cells.pop()
  }

  const nextCell = async (index: number) =>{
    console.log("moving to next index => " + (index + 1 ))
  }

  const prevCell = async (index: number) =>{
    console.log("moving to prev index => " + (index - 1 ))
  }


  // Notebook level

  let index=0

  const saveNotebook =  () => {
    console.log("saving notebook!")
  }
  const addCell =  () => {
    console.log("add cell at index => " + index)
  }
  const cutCell =  () => {
    console.log("cut cell at index => " + index)
  }
  const copyCell =  () => {
    console.log("copy cell at index => " + index)
  }
  const pasteCell =  () => {
    console.log("Paste cell at index => " + index)
  }

  const stopKernel =  () => {
    console.log("Stop Kernel")
  }
  const restartKernel =  () => {
    console.log("Restart kernel")
  }
  const reExecuteNotebook =  () => {
    console.log("ReExecute Notebook")
    console.log("notebook => ", notebook)
  }

  const handleKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      setFocusedIndex((prev) => {
        const newIndex = Math.min(prev + 1, notebook.current.cells.length - 1);
        divRefs.current[newIndex]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        return newIndex;
      });
      event.preventDefault();
    } else if (event.key === 'ArrowUp') {
      setFocusedIndex((prev) => {
        const newIndex = Math.max(prev - 1, 0);
        divRefs.current[newIndex]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        return newIndex;
      });
      event.preventDefault();
    }
  };

  // if (loading) return <p>Loading...</p>;
  // if (error) return <p>Error: {error}</p>;


  return (
    <div className='tab-content'>
      <div className={props.data.display} id='profile' role='tabpanel' aria-labelledby='profile-tab'>
      <NbButtons saveNotebook={saveNotebook}
                addCell={addCell}
                cutCell={cutCell}
                copyCell={copyCell}
                pasteCell={pasteCell}
                submitCell={submitCell}
                stopKernel={stopKernel}
                restartKernel={restartKernel}
                reExecuteNotebook={reExecuteNotebook}
                focusedIndex = {focusedIndex}
                notebook = {notebook}
      />
        
      {debugMode && <div>
        <button type='button' onClick={saveFile}>Save file</button>
        <button type='button' onClick={()=>startASession(props.data.name, props.data.path, props.data.type)}>StartASession</button>
        <button type='button' onClick={startWebSocket}>StartWebSocket</button>
      </div>
      }
      <div className={theme === 'light'? 'editor-body light': 'editor-body dark'}>
        { notebook.current ?
          notebook.current.cells.map((cell, index) =>
            <Cell key={cell.id} 
                  index={index} 
                  cell={cell} 
                  ref = {(el: any) => notebook.current.cells[index] = el} 
                  submitCell={submitCell} 
                  addCellUp={addCellUp} 
                  addCellDown={addCellDown} 
                  prevCell={prevCell}
                  nextCell={nextCell}
                  deleteCell={deleteCell}
                  focusedIndex = {focusedIndex}
                  setFocusedIndex={setFocusedIndex}
                  handleKeyDown={handleKeyDown}
                  divRefs={divRefs}
                  codeMirrorRefs={codeMirrorRefs}
            />
          )
          : (
            <p>No data available</p>)
        }
      </div>
    </div>
  </div>
  )
}
