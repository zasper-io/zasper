import React, { useState, useEffect, useCallback } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { githubLight, githubDark } from '@uiw/codemirror-theme-github';
import { darcula } from '@uiw/codemirror-theme-darcula';
import { keymap, ViewUpdate } from '@codemirror/view';
import Markdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import CellButtons from './CellButtons';
import { languages } from '@codemirror/language-data';
import { useAtom } from 'jotai';
import { themeAtom } from '../../../store/Settings';

const Cell = React.forwardRef((props: any, ref) => {
  const cell = props.cell
  const [theme, setTheme] = useAtom(themeAtom)
  const [cellContents, setCellContents] = useState(cell.source[0])
  const [cursorPosition, setCursorPosition] = useState(0)
  const [totalLines, setTotalLines] = useState(0)

  const onChange = useCallback((value, viewUpdate) => {
    console.log('val:', value);
    setCellContents(value)

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
      <div tabIndex={props.index} className={props.index === props.focusedIndex ? 'single-line activeCell' : 'single-line'}
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
              prevCell={props.prevCell} />
            <div className='inner-content'>
              <div className='cellEditor'>
                <CodeMirror
                  theme={theme == 'light' ? githubLight : githubDark}
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
          prevCell={props.prevCell} /> : <></>
      }


      <div className='inner-content'>
        <div className='serial-no'>[{cell.execution_count}]:</div>
        <div className='cellEditor'>
          <CodeMirror
            theme={theme == 'light' ? githubLight : githubDark}
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

const CellOutput = ({data}) => {
  if ('outputs' in data) {
    if (typeof (data.outputs[0]) !== 'undefined') {
      // console.log(data.outputs[0]);
      if (data.outputs[0].hasOwnProperty('text')) {
        if (data.outputs[0].text) {
          return <pre>{data.outputs[0].text}</pre>
        }

      }
      if (data.outputs[0].hasOwnProperty('text/plain')) {
        
          return <pre>{data.outputs[0]['text/plain']}</pre>
        

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

    return <p>{JSON.stringify(data.outputs[0])}</p>
  }
  return <></>
}


export default Cell;
