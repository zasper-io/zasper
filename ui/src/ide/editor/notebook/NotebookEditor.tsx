import React, { useEffect, useState, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import 'react-toastify/dist/ReactToastify.css';
import './NotebookEditor.scss';

import { w3cwebsocket as W3CWebSocket } from 'websocket';
import { BaseApiUrl, BaseWebSocketUrl } from '../../config';
import NbButtons from './NbButtons';
import Cell, { CodeMirrorRef, ICell } from './Cell';
import { useAtom } from 'jotai';
import { themeAtom } from '../../../store/Settings';
import { IKernel, userNameAtom } from '../../../store/AppState';
import KernelSwitcher from './KernelSwitch';

const debugMode = false;

export default function NotebookEditor(props) {

  interface INotebookModel {
    cells: Array<ICell>;
    nbformat: number;
    nbformat_minor: number;
    metadata: INotebookMetadata;
  }

  interface INotebookMetadata {
    kernelspec?: IKernelspecMetadata;
    language_info?: ILanguageInfoMetadata;
    orig_nbformat?: number;
  }

  interface IKernelspecMetadata {
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


  const [notebook, setNotebook] = useState<INotebookModel>({
    cells: [],
    nbformat: 0,
    nbformat_minor: 0,
    metadata: {},
  });
  const [, setLoading] = useState(true);
  const [, setError] = useState<string>('');
  const [focusedIndex, setFocusedIndex] = useState(0);
  const divRefs = useRef<(HTMLDivElement | null)[]>([]); // Type the refs
  const codeMirrorRefs = useRef<CodeMirrorRef[] | null>([]); 
  const [theme] = useAtom(themeAtom);
  const [kernelWebSocketClient, setKernelWebSocketClient] = useState<IKernelWebSocketClient>({ send: () => {} });
  const [kernelName, setKernelName] = useState<string>(props.data.kernelspec);
  const [session, setSession] = useState<ISession | null>();
  const [kernelStatus, setKernelStatus] = useState("idle")
  const [userName] = useAtom(userNameAtom)
  const [showKernelSwitcher, setShowKernelSwitcher] = useState<boolean>(false);

  const toggleKernelSwitcher = () => {
    setShowKernelSwitcher(!showKernelSwitcher);
}


  interface IKernelWebSocketClient {
    send: any;
  }

  interface ISession {
    id: string;
    kernel: IKernel;
  }

  const FetchFileData = async (path: string) => {
    try {
      const res = await fetch(BaseApiUrl + '/api/contents', {
        method: 'POST',
        body: JSON.stringify({ path : path, type: 'notebook' }),
      });
      if (!res.ok) {
        throw new Error('Failed to fetch data');
      }

      const resJson = await res.json();
      
      if (resJson.content.cells === null) {
        resJson.content.cells = [{
          execution_count: 0,
          source: '',
          cell_type: 'code',
          outputs: [],
        }];
      }
      resJson.content.cells.forEach((cell) => {
        cell.id = uuidv4(); // Add UUID to each cell object
        cell.reload = false;
      });
      setNotebook(resJson.content);
      setLoading(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
      setLoading(false);  // Ensure loading is set to false
    }
  };

  useEffect(() => {
    if (props.data.load_required === true) {
      console.log("called")
      FetchFileData(props.data.path);
      startASession(props.data.path, props.data.name, props.data.type, props.data.kernelspec);
    }
  }, [props.data]);

  useEffect( () => {
    console.log("session", session)
    startWebSocket()
  }, [session])

  const startWebSocket = () => {
    console.log("starting websocket")
    if(session){
      const kernelWebSocketClient = new W3CWebSocket(
        BaseWebSocketUrl + '/api/kernels/' + session.kernel.id + '/channels?session_id=' + session.id
      );

      kernelWebSocketClient.onopen = () => {
        setKernelStatus("connected")
      };

      kernelWebSocketClient.onmessage = (message) => {
        message = JSON.parse(message.data);
        updateNotebook(message);
      };

      kernelWebSocketClient.onclose = () => {
        console.log('disconnected');
      };

      setKernelWebSocketClient(kernelWebSocketClient);
    }
  };

  const startASession =  async (path: string, name: string, type: string, kernelspec: string) => {
    if(kernelspec === 'default'){
      kernelspec = "python3";
      setKernelName("python3")
    }
    // if (!session) {
      fetch(BaseApiUrl + '/api/sessions', {
        method: 'POST',
        body: JSON.stringify({
          path,
          name,
          type,
          kernel: { name : kernelspec },
        }),
      })
        .then(async (response) => await response.json())
        .then((data) => {
          setSession(data);// update session
          console.log('session updated', data);
        })
        .catch((error) => console.log('error', error));
    // }
  };

  function changeKernel(value: string){
    console.log("changing kernel")
    setKernelName(value)
    startASession(props.data.path, props.data.name, props.data.type, value)
  }

  function removeAnsiCodes(str) {
    return str.replace(/\u001b\[[0-9;]*m/g, '');
  }

  const updateNotebook = (message: any) => {
    if(message.header.msg_type === "status"){
      setKernelStatus(message.content.execution_state)
    }

    if (message.header.msg_type === 'execute_input') {     
      setNotebook((prevNotebook) => {
        const updatedCells = prevNotebook.cells.map((cell) => {
          if (cell.id === message.parent_header.msg_id) {
            const updatedCell = { ...cell };
            updatedCell.execution_count = message.content.execution_count;
            return updatedCell;
          }
          return cell;
        });

        return { ...prevNotebook, cells: updatedCells };
      });
    }

    if(message.header.msg_type === 'error'){
        setNotebook((prevNotebook) => {
          const updatedCells = prevNotebook.cells.map((cell) => {
            if (cell.id === message.parent_header.msg_id) {
              const updatedCell = { ...cell };
              updatedCell.outputs = [{
                output_type: 'error',
                ename: message.content.ename,
                evalue: message.content.evalue,
                traceback: message.content.traceback
              }];
            
              return updatedCell;
            }
            return cell;
          });

          return { ...prevNotebook, cells: updatedCells };
        });
      
    }

    if(message.header.msg_type === 'stream'){
      if (message.content.name === 'stdout') {
        console.log("stream")
        setNotebook((prevNotebook) => {
          const updatedCells = prevNotebook.cells.map((cell) => {
            if (cell.id === message.parent_header.msg_id) {
              const updatedCell = { ...cell };
              // if (message.hasOwnProperty('text')) {
                var textMessage = message.content.text
                console.log(textMessage)
                const cleanedArray = removeAnsiCodes(textMessage);
                updatedCell.outputs = [{"text": cleanedArray}];
              // }
              return updatedCell;
            }
            return cell;
          });
  
          return { ...prevNotebook, cells: updatedCells };
        });
      }
    }

    if (message.header.msg_type === 'execute_result') {
      console.log("execute_result")
      setNotebook((prevNotebook) => {
        const updatedCells = prevNotebook.cells.map((cell) => {
          if (cell.id === message.parent_header.msg_id) {
            const updatedCell = { ...cell };
            updatedCell.outputs = [{data: message.content.data}];
           
            return updatedCell;
          }
          return cell;
        });

        return { ...prevNotebook, cells: updatedCells };
      });
    }

    if (message.header.msg_type === 'display_data') {
      console.log("display_data")
      setNotebook((prevNotebook) => {
        const updatedCells = prevNotebook.cells.map((cell) => {
          if (cell.id === message.parent_header.msg_id) {
            const updatedCell = { ...cell };
            updatedCell.outputs = [{data: message.content.data}];
            return updatedCell;
          }
          return cell;
        });

        return { ...prevNotebook, cells: updatedCells };
      });
    }

    
  };

  const updateCellSource = (value: string, cellId: string) => {
  
    setNotebook((prevNotebook) => {
      const updatedCells = prevNotebook.cells.map((cell) => {
        if (cell.id === cellId) {
          return { ...cell, source: value };
        }
        return cell;
      });

      return { ...prevNotebook, cells: updatedCells };
    });
  }

  const changeCellType = (value: string) =>{
    setNotebook((prevNotebook) => {
      const updatedCells = prevNotebook.cells.map((cell, idx) => {
        
        // If index is provided and valid, update the cell at that index
        if (idx === focusedIndex) {
          return { ...cell, cell_type: value };
        }
        return cell;
      });
  
      return { ...prevNotebook, cells: updatedCells };
    });
  }

  const submitCell = (source: string, cellId: string) => {
    console.log('submitting cell:',  cellId);
    setNotebook((prevNotebook) => {
      const updatedCells = prevNotebook.cells.map((cell) => {
        if (cell.id === cellId) {
          return { ...cell, execution_count: -1 , outputs: []};
        }
        return cell;
      });

      return { ...prevNotebook, cells: updatedCells };
    });

    if(session){
      const message = JSON.stringify({
        buffers: [],
        channel: 'shell',
        content: createExecuteRequestMsg(source),
        header: {
          date: getTimeStamp(),
          msg_id: cellId,
          msg_type: 'execute_request',
          session: session.id,
          username: userName,
          version: '5.2',
        },
        metadata: {
          deletedCells: [],
          recordTiming: false,
          cellId: cellId,
        },
        parent_header: {},
      });
  
      kernelWebSocketClient.send(message);
    }
  };

  const createExecuteRequestMsg = (code: string) => {
    return {
      silent: false,
      store_history: true,
      user_expressions: {},
      allow_stdin: true,
      stop_on_error: true,
      code,
    };
  };

  const getTimeStamp = () => new Date().toISOString();

  const addCellUp = () => {
    setNotebook((prevNotebook) => {
      const newCell = {
        execution_count: 0,
        source: '',
        cell_type: 'code',
        id: uuidv4(),
        reload: false,
        outputs: [],
      };
  
      const updatedCells = [
        ...prevNotebook.cells.slice(0, focusedIndex),
        newCell,                                      // The new cell to be inserted
        ...prevNotebook.cells.slice(focusedIndex),
      ];
  
      return { ...prevNotebook, cells: updatedCells };
    });
  };

  const addCellDown = () => {
    setNotebook((prevNotebook) => {
      const newCell = {
        execution_count: 0,
        source: '',
        cell_type: 'code',
        id: uuidv4(),
        reload: false,
        outputs: [],
      };
      // Ensure the focusedIndex is within the bounds of the cells array
    const index = focusedIndex >= 0 && focusedIndex < prevNotebook.cells.length
      ? focusedIndex + 1
      : prevNotebook.cells.length;

    const updatedCells = [
      ...prevNotebook.cells.slice(0, index),  // Cells before the focused index
      newCell,  // The new cell to add
      ...prevNotebook.cells.slice(index),  // Cells after the focused index
    ];

    return { ...prevNotebook, cells: updatedCells };
    });
  };

  // const deleteCell = (index: number) => {
  //   setNotebook((prevNotebook) => {
  //     const updatedCells = prevNotebook.cells.filter((_, i) => i !== index);
  //     return { ...prevNotebook, cells: updatedCells };
  //   });
  // };
  

  const deleteCell = () => {
    setNotebook((prevNotebook) => {
      // Check if focusedIndex is valid to avoid errors (e.g., empty notebook or invalid index)
      if (focusedIndex < 0 || focusedIndex >= prevNotebook.cells.length) {
        return prevNotebook; // No change if the index is invalid
      }

      const updatedCells = [
        ...prevNotebook.cells.slice(0, focusedIndex), // Cells before the focused index
        ...prevNotebook.cells.slice(focusedIndex + 1), // Cells after the focused index
      ];

      return { ...prevNotebook, cells: updatedCells };
    });
  };

  const [copiedCell, setCopiedCell] = useState<ICell|null>(null);  // To store the copied or cut cell
  const [cutCellIndex, setCutCellIndex] = useState<number|null>(null); // To store the index of the cut cell

// Function to copy the cell at the current focused index
  const copyCell = () => {
    setCopiedCell(notebook.cells[focusedIndex]);
  };

  // Function to cut the cell (copy it and remove from notebook)
  const cutCell = () => {
    const cellToCut = notebook.cells[focusedIndex];
    setCopiedCell(cellToCut); // Copy the cell to allow pasting later
    setCutCellIndex(focusedIndex); // Store the index of the cut cell
    setNotebook((prevNotebook) => {
      const updatedCells = [
        ...prevNotebook.cells.slice(0, focusedIndex),
        ...prevNotebook.cells.slice(focusedIndex + 1),
      ];
      return { ...prevNotebook, cells: updatedCells };
    });
  };

  // Function to paste the copied or cut cell at the current focused index
  const pasteCell = () => {
    if (!copiedCell) return; // No cell to paste
    
    setNotebook((prevNotebook) => {
      const newCell = { ...copiedCell, id: uuidv4() }; // Ensure the pasted cell has a new unique ID

      // Determine the paste index (after focusedIndex or at the end of the notebook)
      const index = focusedIndex >= 0 && focusedIndex < prevNotebook.cells.length
        ? focusedIndex + 1
        : prevNotebook.cells.length;

      const updatedCells = [
        ...prevNotebook.cells.slice(0, index),
        newCell,  // Insert the copied or cut cell
        ...prevNotebook.cells.slice(index),
      ];

      return { ...prevNotebook, cells: updatedCells };
    });

    // If it's a cut, reset cut state after pasting
    if (cutCellIndex !== null) {
      setCutCellIndex(null); // Reset cut cell state
    }
};


  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      setFocusedIndex((prev) => {
        const newIndex = Math.min(prev + 1, notebook.cells.length - 1);
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

    // Handle adding cells with shortcuts (A/B for add above/below)
    if (event.key === 'a' && event.ctrlKey) {
      addCellUp(); // Ctrl + A -> Add cell above
      event.preventDefault();
    } else if (event.key === 'b' && event.ctrlKey) {
      addCellDown(); // Ctrl + B -> Add cell below
      event.preventDefault();
    }

    // Handle deleting a cell (D, D for delete)
    if (event.key === 'd' && event.ctrlKey && event.shiftKey) {
      deleteCell(); // Ctrl + Shift + D -> Delete cell
      event.preventDefault();
    }

    // Handle copy/cut/paste
    if (event.key === 'c' && event.ctrlKey) {
      copyCell(); // Ctrl + C -> Copy cell
      event.preventDefault();
    } else if (event.key === 'x' && event.ctrlKey) {
      cutCell(); // Ctrl + X -> Cut cell
      event.preventDefault();
    } else if (event.key === 'v' && event.ctrlKey) {
      pasteCell(); // Ctrl + V -> Paste cell
      event.preventDefault();
    }

     // Handle running a cell with Ctrl + Enter (no move) or Shift + Enter (move to next)
    if (event.key === 'Enter') {
      if (event.ctrlKey) {
        submitCell(notebook.cells[focusedIndex].source, notebook.cells[focusedIndex].id); // Ctrl + Enter -> Run cell
      } else if (event.shiftKey) {
        submitCell(notebook.cells[focusedIndex].source, notebook.cells[focusedIndex].id); // Shift + Enter -> Run and move to next
        setFocusedIndex((prev) => Math.min(prev + 1, notebook.cells.length - 1)); // Move to next cell after running
      }
      event.preventDefault();
    }

    // Handle cell type change (Y for code, M for markdown)
    if (event.key === 'y' && event.ctrlKey) {
      changeCellType('code'); // Ctrl + Y -> Change cell to code
      event.preventDefault();
    } else if (event.key === 'm' && event.ctrlKey) {
      changeCellType('markdown'); // Ctrl + M -> Change cell to markdown
      event.preventDefault();
    }

    // Handle saving the notebook with Cmd/Ctrl + S
    if ((event.key === 's' && event.ctrlKey) || (event.key === 's' && event.metaKey)) {
      handleCmdEnter(); // Ctrl + S (or Cmd + S) -> Save notebook
      event.preventDefault();
    }

    // Handle undo (Ctrl + Z)
    if (event.key === 'z' && event.ctrlKey) {
      console.log('Undo action'); // Add undo logic here if necessary
      event.preventDefault();
    }

  };

  const handleCmdEnter = () => {
      console.log('Saving notebook')
  
      fetch(BaseApiUrl + '/api/contents', {
        method: 'PUT',
        body: JSON.stringify({
          path: props.data.path,
          content: notebook,
          type: 'notebook',
          format: 'json'
        })
      })
  
      return true
    }

  return (
    <div className="tab-content">
      <div className={props.data.active ? 'd-block' : 'd-none'} id="profile" role="tabpanel" aria-labelledby="profile-tab">
        <NbButtons
          saveNotebook={handleCmdEnter}
          addCellDown={addCellDown}
          cutCell={cutCell}
          copyCell={copyCell}
          pasteCell={pasteCell}
          submitCell={submitCell}
          stopKernel={() => console.log('stop kernel')}
          restartKernel={() => console.log('restart kernel')}
          reExecuteNotebook={() => console.log('reexecute notebook')}
          focusedIndex={focusedIndex}
          notebook={notebook}
          kernelName={kernelName}
          kernelStatus={kernelStatus}
          changeCellType={changeCellType}
          startWebSocket={startWebSocket}
          toggleKernelSwitcher={toggleKernelSwitcher}
        />
        {debugMode && (
          <div>
            <button type="button" onClick={() => console.log("saving file")}>
              Save file
            </button>
            <button type="button" onClick={() => startASession(props.data.path, props.data.name, props.data.type, props.data.kernelspec)}>
              StartASession
            </button>
            <button type="button" onClick={startWebSocket}>
              StartWebSocket
            </button>
          </div>
        )}
       
        <div className={theme === 'light' ? 'editor-body light' : 'editor-body dark'}>
        {showKernelSwitcher && <KernelSwitcher kernelName={kernelName} toggleKernelSwitcher={toggleKernelSwitcher}  changeKernel={changeKernel}/>}
          {notebook.cells &&
            notebook.cells.map((cell, index) => (
              <Cell
                key={cell.id}
                index={index}
                cell={cell}
                submitCell={submitCell}
                addCellUp={addCellUp}
                addCellDown={addCellDown}
                prevCell={() => console.log('prev cell')}
                nextCell={() => console.log('next cell')}
                deleteCell={deleteCell}
                focusedIndex={focusedIndex}
                setFocusedIndex={setFocusedIndex}
                handleKeyDown={handleKeyDown}
                divRefs={divRefs}
                execution_count={cell.execution_count}
                codeMirrorRefs={codeMirrorRefs}
                updateCellSource={updateCellSource}
              />
            ))}
        </div>
      </div>
    </div>
  );
}
