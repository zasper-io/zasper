import React, { useState, useCallback } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { githubLight, githubDark } from '@uiw/codemirror-theme-github';
// import { darcula } from '@uiw/codemirror-theme-darcula';
import { keymap, ViewUpdate } from '@codemirror/view';
import Markdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import CellButtons from './CellButtons';
import { languages } from '@codemirror/language-data';
import { useAtom } from 'jotai';
import { themeAtom } from '../../../store/Settings';


type CellType = 'code' | 'markdown' | 'raw' | string;

export interface ICell {
  cell_type: CellType;
  id: string;
  execution_count: number;
  source: string;
  outputs: any;
  reload: boolean;
}

interface ICellProps{
    cell: ICell;
    index: number;
    submitCell: (source: string, cellId: string) => void;
    addCellUp: () => void;
    addCellDown: () => void;
    prevCell: () => void;
    nextCell: () => void;
    deleteCell: (index: number) => void;
    focusedIndex: number;
    setFocusedIndex: (index: number) => void;
    handleKeyDown: any;
    divRefs: React.RefObject<(HTMLDivElement | null)[]>;
    execution_count: number;
    codeMirrorRefs: any;
    updateCellSource: any;
}

export interface CodeMirrorRef {
  editor: {
    focus: () => void;
  };
}

const Cell = React.forwardRef((props: ICellProps, ref) => {
  const cell = props.cell
  const [theme] = useAtom(themeAtom)
  const [cellContents, setCellContents] = useState(cell.source)
  const [cursorPosition, setCursorPosition] = useState(0)
  const [totalLines, setTotalLines] = useState(0)

  const onChange = useCallback((value, viewUpdate) => {
    setCellContents(value)
    props.updateCellSource(value, props.cell.id)
  }, []);

  const onUpdate = useCallback((viewUpdate: ViewUpdate) => {
    if (viewUpdate) {
      const { state } = viewUpdate;
      const cursor = state.selection.main.from;
      const line = state.doc.lineAt(cursor).number;

      const totalLines = state.doc.lines;
      setCursorPosition(line)
      setTotalLines(totalLines)

    }
    // props.setFocusedIndex(props.index)

  }, []);

  const handleKeyDownCM = (event) => {
    if (event.key === 'ArrowDown' && cursorPosition === totalLines) {
      props.handleKeyDown({ key: "ArrowDown", preventDefault: () => { } })
      event.preventDefault();
    } else if (event.key === 'ArrowUp' && cursorPosition === 1) {
      props.handleKeyDown({ key: "ArrowUp", preventDefault: () => { } })
      event.preventDefault();
    }
  };



  const handleCmdEnter = () => {
    if(props.cell.cell_type === "code"){
      props.submitCell(cellContents, props.cell.id)
    }
    props.handleKeyDown({ key: "ArrowDown", preventDefault: () => { } })
    return true
  }

  const customKeymap = keymap.of([
    {
      key: 'Shift-Enter',
      run: handleCmdEnter
    }
  ])

  // Make sure divRefs.current is not null before assigning
  const divRef = (el: HTMLDivElement | null) => {
    if (props.divRefs.current) {
      props.divRefs.current[props.index] = el;
    }
  };


  if (cell.cell_type === 'markdown') {
    return (
      <div tabIndex={props.index} className={props.index === props.focusedIndex ? 'single-line activeCell' : 'single-line'}
        ref={divRef} onKeyDown={props.handleKeyDown} onFocus={() => props.setFocusedIndex(props.index)}>


        {props.index === props.focusedIndex ?
          <>

            <CellButtons index={props.index}
              cellId={cell.id}
              code={cellContents}
              addCellUp={props.addCellUp}
              addCellDown={props.addCellDown}
              submitCell={props.submitCell}
              deleteCell={props.deleteCell}
              nextCell={props.nextCell}
              prevCell={props.prevCell} />
            <div className='inner-content'>
              <div className='cellEditor'>
                <CodeMirror
                  theme={theme === 'light' ? githubLight : githubDark}
                  value={cellContents}
                  height='auto'
                  width='100%'
                  extensions={[markdown({ base: markdownLanguage, codeLanguages: languages }), customKeymap]}
                  autoFocus={props.index === props.focusedIndex ? true : false}
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
      className={props.index === props.focusedIndex ? 'single-line activeCell' : 'single-line'}
      ref={divRef} onFocus={() => props.setFocusedIndex(props.index)}>
      {props.index === props.focusedIndex ?
        <CellButtons index={props.index}
          code={cellContents}
          cellId={cell.id}
          submitCell={props.submitCell}
          addCellUp={props.addCellUp}
          addCellDown={props.addCellDown}
          deleteCell={props.deleteCell}
          nextCell={props.nextCell}
          prevCell={props.prevCell} /> : <></>
      }


      <div className='inner-content'>
        <div className='serial-no'>[{props.execution_count}]:</div>
        <div className='cellEditor'>
          <CodeMirror
            theme={theme === 'light' ? githubLight : githubDark}
            value={cellContents}
            height='auto'
            width='100%'
            extensions={[python(), customKeymap]}
            autoFocus={props.index === props.focusedIndex ? true : false}
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
        <CellOutput data={cell}/>
      </div>
    </div>
  )
})

const CellOutput = ({ data }) => {
  if (!data) {
    return null;
  }

  const { outputs } = data;
  if (outputs && outputs.length > 0) {
    const output = outputs[0];

    if (output.output_type === 'error') {
      const { ename, evalue, traceback } = output;

      // Clean up the traceback by removing ANSI escape codes
      const cleanTraceback = traceback
        ? traceback.map(line => line.replace(/\u001b\[[0-9;]*m/g, ''))
        : [];

      return (
        <div style={{ color: 'red' }}>
          <h6>{ename}: {evalue}</h6>
          <pre>{cleanTraceback.join('\n')}</pre>
        </div>
      );
    }

    const { text, 'text/plain': textPlain, data } = output;

    if (text) {
      return <pre>{String(text.replace(/\u001b\[[0-9;]*m/g, ''))}</pre>;
    }

    if (textPlain) {
      return <pre>{textPlain}</pre>;
    }

    if (data) {
      const { 'text/html': htmlContent, 'image/png': imageContent, 'text/plain': textPlainData } = data;

      if (htmlContent) {
        return <div dangerouslySetInnerHTML={{ __html: htmlContent }} />;
      }

      if (imageContent) {
        const blob = `data:image/png;base64,${imageContent}`;
        return (
          <div>
            <img src={blob} alt="image" />
          </div>
        );
      }

      if (textPlainData) {
        return (
          <div>
            <pre>{textPlainData}</pre>
          </div>
        );
      }
    }

    return <p>{JSON.stringify(output)}</p>;
  }

  return null; 
};




export default Cell;
