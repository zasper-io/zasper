import React, { useEffect, useState, useRef, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import 'react-toastify/dist/ReactToastify.css';
import './NotebookEditor.scss';

import { w3cwebsocket as W3CWebSocket } from 'websocket';
import { BaseApiUrl } from '../../config';
import NbButtons from './NbButtons';
import Cell from './Cell';
import { useAtom } from 'jotai';
import { themeAtom } from '../../../store/Settings';
import { IKernel, kernelsAtom } from '../../../store/AppState';

const debugMode = true;

interface CodeMirrorRef {
  editor: {
    focus: () => void;
  };
}

export default function NotebookEditor(props) {
  interface ICell {
    cell_type: CellType;
    id: string;
    execution_count: number;
    source: string;
    outputs: any;
    reload: boolean;
  }

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

  type CellType = 'code' | 'markdown' | 'raw' | string;

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
  const codeMirrorRefs = useRef<CodeMirrorRef[]>([]); 
  const [theme] = useAtom(themeAtom);
  const [client, setClient] = useState<IClient>({ send: () => {} });
  const [kernelName, setKernelName] = useState<string>('');
  const [kernelMap, setKernelMap] = useAtom(kernelsAtom);
  const [session, setSession] = useState<ISession>({ id: '', kernel: { id: '', name: '' } });

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
      startASession(props.data.path, props.data.name, props.data.type);
    }
  }, [props.data]);

  const startWebSocket = () => {
    const client1 = new W3CWebSocket(
      'ws://localhost:8888/api/kernels/' + session.kernel.id + '/channels?session_id=' + session.id
    );

    client1.onopen = () => {
      console.log('WebSocket Client Connected');
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
  };

  const startASession = (path: string, name: string, type: string) => {
    if (!session.id && kernelMap) {
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

  const updateNotebook = (message: any) => {
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
            updatedCell.execution_count = message.execution_count;
            return updatedCell;
          }
          return cell;
        });

        return { ...prevNotebook, cells: updatedCells };
      });
    }
  };

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
        version: '5.2',
      },
      metadata: {
        deletedCells: [],
        recordTiming: false,
        cellId: '1cb16896-03e7-480c-aa2b-f1ba6bb1b56d',
      },
      parent_header: {},
    });

    client.send(message);
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
    setNotebook((prevNotebook) => ({
      ...prevNotebook,
      cells: [
        ...prevNotebook.cells,
        {
          execution_count: 0,
          source: '',
          cell_type: 'raw',
          id: uuidv4(),
          reload: false,
          outputs: '',
        },
      ],
    }));
  };

  const addCellDown = () => {
    setNotebook((prevNotebook) => ({
      ...prevNotebook,
      cells: [
        ...prevNotebook.cells,
        {
          execution_count: 0,
          source: '',
          cell_type: 'raw',
          id: uuidv4(),
          reload: false,
          outputs: '',
        },
      ],
    }));
  };

  const deleteCell = (index: number) => {
    setNotebook((prevNotebook) => {
      const updatedCells = prevNotebook.cells.filter((_, i) => i !== index);
      return { ...prevNotebook, cells: updatedCells };
    });
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

  return (
    <div className="tab-content">
      <div className={props.data.active ? 'd-block' : 'd-none'} id="profile" role="tabpanel" aria-labelledby="profile-tab">
        <NbButtons
          saveNotebook={() => console.log('saving notebook')}
          addCell={addCellUp}
          cutCell={() => console.log('cut cell')}
          copyCell={() => console.log('copy cell')}
          pasteCell={() => console.log('paste cell')}
          submitCell={submitCell}
          stopKernel={() => console.log('stop kernel')}
          restartKernel={() => console.log('restart kernel')}
          reExecuteNotebook={() => console.log('reexecute notebook')}
          focusedIndex={focusedIndex}
          notebook={notebook}
          kernelName={kernelName}
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
              />
            ))}
        </div>
      </div>
    </div>
  );
}
