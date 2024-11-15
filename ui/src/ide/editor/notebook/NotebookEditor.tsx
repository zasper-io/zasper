
import React, { useEffect, useState, useRef, useCallback } from 'react'

import CodeMirror from '@uiw/react-codemirror'
import { python } from '@codemirror/lang-python'
import { v4 as uuidv4 } from 'uuid'
import Markdown from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import { keymap, ViewUpdate } from '@codemirror/view'
import 'react-toastify/dist/ReactToastify.css';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'

import './NotebookEditor.scss'

import { w3cwebsocket as W3CWebSocket } from 'websocket'
import { BaseApiUrl } from '../../config'

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
      // startASession(props.name, props.path, props.type)
      // listKernels();
      // listAllSessions();
    }
     // Focus the CodeMirror editor when the index changes
    // if (codeMirrorRefs.current[focusedIndex]) {
    //   codeMirrorRefs.current[focusedIndex].editor.focus();
    // }
   
  }, [])

  const generateOutput = (data) => {
    if ('outputs' in data) {
      if (typeof (data.outputs[0]) !== 'undefined') {
        // console.log(data.outputs[0]);
        if (data.outputs[0].hasOwnProperty('text')) {
          return <pre>{data.outputs[0].text}</pre>
        }
        if (data.outputs[0].hasOwnProperty('data')) {
          if (data.outputs[0].data.hasOwnProperty('text/html')) {

          }
          if (data.outputs[0].data.hasOwnProperty('image/png')) {
            const blob = 'data:image/png;base64,' + (data.outputs[0].data['image/png'])
            return (
              <div>
                <img src={blob} />
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

      return JSON.stringify(data.outputs[0])
    }
  }

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

  const listKernels = () => {
    // Simple GET request using fetch
    fetch(BaseApiUrl + 'http://localhost:8888/api/kernels')
      .then(async response => await response.json())
      .then(
        (data) => {
          console.log('kernels running')
          console.log(data)
          if (data.lenghth = 0) {
            
          }
        },
        (error) => {
          console.log('error')
        }

      )
  }

  const listAllSessions = () => {
    // Simple GET request using fetch
    fetch(BaseApiUrl + '/api/sessions')
      .then(async response => await response.json())
      .then(
        (data) => {
          console.log('data')
          console.log(data)
          if (data.lenghth === 0) {
            startASession(props.name, props.path, props.type)
          }
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
      // message = JSON.parse(message.data)
      // if (message.channel === 'iopub') {
      //   console.log('IOPub => ', message)
      //   if (message.msg_type === 'execute_result') {
      //     console.log(message.content.data)
      //     toast(message.content.data['text/plain'])
      //     toast(message.content.data['text/html'])
      //   }
      //   if (message.msg_type === 'stream') {
      //     console.log(message.content.text)
      //     toast(message.content.text)
      //     toast(message.content.text)
      //   }
      // }
      // if (message.channel === 'shell') {
      //   console.log('Shell => ', message)
      // }
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
      id: uuidv4()
    })

  }

  const addCellDown = async () =>{
    console.log("add cell Down");
    notebook.current.cells.push({
      execution_count: 0,
      source: "",
      cell_type: "raw",
      id: uuidv4()
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

  if (loading) return <p>Loading...</p>;
  if (error) return <p>Error: {error}</p>;


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
        <button type='button' onClick={listKernels}>ListKernels</button>
        <button type='button' onClick={()=>startASession(props.data.name, props.data.path, props.data.type)}>StartASession</button>
        <button type='button' onClick={listAllSessions}>ListAllSessions</button>
        <button type='button' onClick={startWebSocket}>StartWebSocket</button>
      </div>
      }
      <div className='editor-body'>
        { notebook.current ?
          notebook.current.cells.map((cell, index) =>
            <Cell key={index} 
                  index={index} 
                  cell={cell} 
                  ref = {(el) => notebook.current.cells[index] = el} 
                  generateOutput={generateOutput} 
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

function NbButtons(props){

  const [kernelName, setKernelName] = useState("Python [conda env:default]*")

  const options = [

    { label: 'Code', value: 'code' },
 
    { label: 'Markdown', value: 'markdown' },
 
    { label: 'Raw', value: 'raw' },
 
  ];

  const handleChange = (event) => {

    // setValue(event.target.value);
 
  };
  // const [value, setValue] = useState(props.notebook.cells[props.focusedIndex].cell_type)

  return (
    <div className='text-editor-tool'>
      <button type='button' className='editor-button' onClick={() => props.saveNotebook()}><i className='fas fa-save' /></button>
      <button type='button' className='editor-button' onClick={() => props.addCell(props.index)}><i className='fas fa-plus' /></button>
      <button type='button' className='editor-button' onClick={() => props.cutCell(props.index)}><i className='fas fa-cut' /></button>
      <button type='button' className='editor-button' onClick={() => props.copyCell(props.index)}><i className='fas fa-copy' /></button>
      <button type='button' className='editor-button' onClick={() => props.pasteCell(props.index)}><i className='fas fa-paste' /></button>
      <button type='button' className='editor-button' onClick={() => props.submitCell(props.index)}><i className='fas fa-play' /></button>
      <button type='button' className='editor-button' onClick={() => props.stopKernel()}><i className='fas fa-square' /></button>
      <button type='button' className='editor-button' onClick={() => props.restartKernel()}><i className='fas fa-redo' /></button>
      <button type='button' className='editor-button' onClick={() => props.reExecuteNotebook()}><i className='fas fa-forward' /></button>
      <select className="form-select editor-select" value={props.notebook.current.cells.length > 0 && props.notebook.current.cells[props.focusedIndex].cell_type} onChange={handleChange}>
        {options.map((option, index) => (
          <option key={index} value={option.value}>{option.label}</option>
        ))}
      </select>
      {props.notebook.current.cells.length > 0 && props.notebook.current.cells[props.focusedIndex].cell_type}
      <div className='ms-auto'>{kernelName}</div>
      <div className="kStatus">idle</div>
    </div>
  )
}

function CellButtons(props){
  return (
    <div className='cellOptionsDiv'>
      <div className='cellOptions'>
        <button type='button' className='editor-button' onClick={() => props.submitCell(props.code, props.cellId)}><i className='fas fa-play' /></button>
        <button type='button' className='editor-button' onClick={() => props.copyCell(props.index)}><i className='fas fa-copy' /></button>
        <button type='button' className='editor-button' onClick={() => props.nextCell(props.index)}><i className='fas fa-forward' /></button>
        <button type='button' className='editor-button' onClick={() => props.prevCell(props.index)}><i className='fas fa-backward' /></button>
        <button type='button' className='editor-button' onClick={() => props.addCellUp()}><i className='fas fa-plus' /></button>
        <button type='button' className='editor-button' onClick={() => props.addCellDown()}><i className='fas fa-plus' /></button>
        <button type='button' className='editor-button' onClick={() => props.deleteCell(props.index)}><i className='fas fa-trash' /></button>
      </div>
    </div>
  )
}

function Cell (props) {
  const cell = props.cell
  const [cellContents, setCellContents] = useState(cell.source[0])
  const[cursorPosition, setCursorPosition] = useState(0)
  const[totalLines, setTotalLines] = useState(0)

  const onChange = useCallback((value, viewUpdate) => {
    console.log('val:', value);
    setCellContents(value)

  }, []);

  const onUpdate =  useCallback(( viewUpdate: ViewUpdate) => {
    if(viewUpdate){
      const { state } = viewUpdate;
      const cursor = state.selection.main.from;
      const line = state.doc.lineAt(cursor).number;
        
      const totalLines = state.doc.lines;
      setCursorPosition(line)
      setTotalLines(totalLines)

    }

  }, []);

  const handleKeyDownCM = (event) => {
    if (event.key === 'ArrowDown' && cursorPosition === totalLines) {
      props.handleKeyDown({key:"ArrowDown", preventDefault: ()=>{}})
      event.preventDefault();
    } else if (event.key === 'ArrowUp'  && cursorPosition ===  1) {
      props.handleKeyDown({key:"ArrowUp", preventDefault: ()=>{}})
      event.preventDefault();
    }
  };

  const handleCmdEnter = () => {
    props.submitCell(cellContents)
    return true
  }

  const customKeymap = keymap.of([
    {
      key: 'Shift-Enter',
      run: handleCmdEnter
    }
  ])

  if (cell.cell_type === 'markdown') {
    return (
      <div tabIndex={props.index}  className={props.index === props.focusedIndex ? 'single-line activeCell': 'single-line'} 
      ref={(el) => (props.divRefs.current[props.index] = el)}
      onKeyDown={props.handleKeyDown} onFocus={() => props.setFocusedIndex(props.index)}>
        
          
          {props.index === props.focusedIndex ?  
            <>
              
                <CellButtons index={props.index} 
                        cellId={cell.id}
                        code={cellContents}
                        addCellUp={props.addCellUp} 
                        addCellDown={props.addCellDown} 
                        deleteCell={props.deleteCell} 
                        nextCell={props.nextCell} 
                        prevCell={props.prevCell}/>
                <div className='inner-content'>
                  <div className='cellEditor'>
                    <CodeMirror
                      value={cellContents}
                      height='auto'
                      width='100%'
                      extensions={[markdown({ base: markdownLanguage, codeLanguages: languages }),customKeymap]}
                      autoFocus={props.index === props.focusedIndex ? true: false} 
                      onChange={onChange}
                      onUpdate={onUpdate}
                      onKeyDown={handleKeyDownCM}
                      basicSetup={{
                        lineNumbers: false,
                        bracketMatching: true,
                        highlightActiveLineGutter: true,
                        autocompletion: true,
                        lintKeymap: true,
                        foldGutter: true,
                        completionKeymap: true,
                        tabSize: 4
                      }}
                    />
                  </div>
                </div>
            </>
            :
            <Markdown rehypePlugins={[rehypeRaw]}>{cellContents}</Markdown> 
        }
          
          </div>
      
    )
  }
  

  return (
    <div tabIndex={props.index} 
        className={props.index === props.focusedIndex ? 'single-line activeCell': 'single-line'}  
        ref={(el) => (props.divRefs.current[props.index] = el)}
        onFocus={() => props.setFocusedIndex(props.index)}>
        {props.index === props.focusedIndex ?  
        <CellButtons index={props.index} 
                    code={cellContents}
                    cellId={cell.id} 
                    submitCell={props.submitCell} 
                    addCellUp={props.addCellUp} 
                    addCellDown={props.addCellDown} 
                    deleteCell={props.deleteCell} 
                    nextCell={props.nextCell} 
                    prevCell={props.prevCell}/> : <></>
        }

      
      <div className='inner-content'>
        <div className='serial-no'>[{cell.execution_count}]:</div>  
        <div className='cellEditor'>
          <CodeMirror
            value={cellContents}
            height='auto'
            width='100%'
            extensions={[python(),customKeymap]}
            autoFocus={props.index === props.focusedIndex ? true: false} 
            onChange={onChange}
            onUpdate={onUpdate}
            onKeyDown={handleKeyDownCM}
            basicSetup={{
              lineNumbers: false,
              bracketMatching: true,
              highlightActiveLineGutter: true,
              autocompletion: true,
              lintKeymap: true,
              foldGutter: true,
              completionKeymap: true,
              tabSize: 4
            }}
          />
        </div>
      </div>
      <div className='inner-text'>
          {props.generateOutput(cell)}
        </div>
    </div>
  )
}
