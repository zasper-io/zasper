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
import { IKernel, kernelsAtom, userNameAtom } from '../../../store/AppState';

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [focusedIndex, setFocusedIndex] = useState(0);
  const divRefs = useRef<(HTMLDivElement | null)[]>([]); // Type the refs
  const codeMirrorRefs = useRef<CodeMirrorRef[] | null>([]); 
  const [theme] = useAtom(themeAtom);
  const [client, setClient] = useState<IClient>({ send: () => {} });
  const [kernelName, setKernelName] = useState<string>('');
  const [kernelMap, setKernelMap] = useAtom(kernelsAtom);
  const [session, setSession] = useState<ISession | null>();
  const [kernelStatus, setKernelStatus] = useState("idle")
  const [userName] = useAtom(userNameAtom)

  interface IClient {
    send: any;
  }

  interface ISession {
    id: string;
    kernel: IKernel;
  }

  const FetchFileData = async (path: string) => {
    try {
      const res = await fetch(BaseApiUrl + '/api/contents?type=notebook&hash=0', {
        method: 'POST',
        body: JSON.stringify({ path }),
      });

      if (!res.ok) {
        throw new Error('Failed to fetch data');
      }

      const resJson = await res.json();
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
      FetchFileData(props.data.path);
      const session = startASession(props.data.path, props.data.name, props.data.type);
    }
  }, [props.data]);

  useEffect( () => {
    startWebSocket()
  }, [session])

  const startWebSocket = () => {
    if(session){
      const client1 = new W3CWebSocket(
        BaseWebSocketUrl + '/api/kernels/' + session.kernel.id + '/channels?session_id=' + session.id
      );

      client1.onopen = () => {
        setKernelStatus("connected")
      };

      client1.onmessage = (message) => {
        message = JSON.parse(message.data);
        if (message.msg_type === 'execute_request') {
          updateNotebook(message);
        }
      };

      client1.onclose = () => {
        console.log('disconnected');
      };

      setClient(client1);
    }
  };

  const startASession =  async (path: string, name: string, type: string) => {
    if (!session && kernelMap) {
      fetch(BaseApiUrl + '/api/sessions', {
        method: 'POST',
        body: JSON.stringify({
          path,
          name,
          type,
          notebook: { path, name },
        }),
      })
        .then(async (response) => await response.json())
        .then((data) => {
          setSession(data);
          const updatedKernel = { ...kernelMap, [data.kernel.id]: data.kernel };
          setKernelMap(updatedKernel);
        })
        .catch((error) => console.log('error', error));
    }
  };

  function removeAnsiCodes(str) {
    return str.replace(/\u001b\[[0-9;]*m/g, '');
  }

  const updateNotebook = (message: any) => {
    console.log(message)
    if(message.hasOwnProperty('execution_state')){
      setKernelStatus(message.execution_state)
    }

    if (message.hasOwnProperty('execution_count')) {
      setNotebook((prevNotebook) => {
        const updatedCells = prevNotebook.cells.map((cell) => {
          if (cell.id === message.msg_id) {
            const updatedCell = { ...cell };
            updatedCell.execution_count = message.execution_count;
            return updatedCell;
          }
          return cell;
        });

        return { ...prevNotebook, cells: updatedCells };
      });
    }
    if (message.hasOwnProperty('traceback')) {
      setNotebook((prevNotebook) => {
        const updatedCells = prevNotebook.cells.map((cell) => {
          if (cell.id === message.msg_id) {
            const updatedCell = { ...cell };
            if (message.hasOwnProperty('traceback')) {
              updatedCell.outputs = [{
                output_type: 'error',
                ename: message.ename,
                evalue: message.evalue,
                traceback: message.traceback
              }];
            }
            return updatedCell;
          }
          return cell;
        });

        return { ...prevNotebook, cells: updatedCells };
      });
    }

    if (message.hasOwnProperty('data')) {
      setNotebook((prevNotebook) => {
        const updatedCells = prevNotebook.cells.map((cell) => {
          if (cell.id === message.msg_id) {
            const updatedCell = { ...cell };
            if (message.hasOwnProperty('data')) {
              updatedCell.outputs = [message.data];
            }
            if (message.hasOwnProperty('traceback')) {
              updatedCell.outputs = [message.traceback];
            }
            return updatedCell;
          }
          return cell;
        });

        return { ...prevNotebook, cells: updatedCells };
      });
    }

    if (message.hasOwnProperty('text')) {
      setNotebook((prevNotebook) => {
        const updatedCells = prevNotebook.cells.map((cell) => {
          if (cell.id === message.msg_id) {
            const updatedCell = { ...cell };
            if (message.hasOwnProperty('text')) {
              var traceback = message.text
              const cleanedArray = removeAnsiCodes(traceback);
              updatedCell.outputs = [{"text": cleanedArray}];
            }
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
    setNotebook((prevNotebook) => {
      const updatedCells = prevNotebook.cells.map((cell) => {
        if (cell.id === cellId) {
          return { ...cell, execution_count: -1 };
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
  
      client.send(message);
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
        cell_type: 'markdown',
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
        />
        {debugMode && (
          <div>
            <button type="button" onClick={() => console.log("saving file")}>
              Save file
            </button>
            <button type="button" onClick={() => startASession(props.data.path, props.data.name, props.data.type)}>
              StartASession
            </button>
            <button type="button" onClick={startWebSocket}>
              StartWebSocket
            </button>
          </div>
        )}
        <div className={theme === 'light' ? 'editor-body light' : 'editor-body dark'}>
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
