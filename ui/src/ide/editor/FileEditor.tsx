
import React, { useCallback, useEffect, useRef, useState } from 'react'

import CodeMirror from '@uiw/react-codemirror'
import { githubLight, githubDark } from '@uiw/codemirror-theme-github';
import { linter } from '@codemirror/lint';
import { darcula } from '@uiw/codemirror-theme-darcula';
import { python } from '@codemirror/lang-python'
import { html } from '@codemirror/lang-html'
import { go } from '@codemirror/lang-go'
import { less } from '@codemirror/lang-less'
import { sass } from '@codemirror/lang-sass'
import { json, jsonParseLinter } from '@codemirror/lang-json'
import { javascript, esLint } from '@codemirror/lang-javascript'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { EditorView, keymap, ViewUpdate } from '@codemirror/view'
import { BaseApiUrl } from '../config'

import './FileEditor.scss'
import { themeAtom } from '../../store/Settings'
import { useAtom } from 'jotai'
import { columnPositionAtom, indentationSizeAtom, linePositionAtom } from '../../store/AppState';

// Define the types for the editor reference
interface CodeMirrorEditor extends EditorView {
  getCursor(): { line: number; ch: number }; // Type for getCursor()
}

export default function FileEditor (props) {
  const [fileContents, setFileContents] = useState('')
  const [theme, setTheme] = useAtom(themeAtom)

  const handleCmdEnter = () => {
    console.log('Saving file')

    fetch(BaseApiUrl + '/api/contents', {
      method: 'PUT',
      body: JSON.stringify({
        path: props.data.path,
        content: fileContents,
        type: 'file',
        format: 'text'
      })
    })

    return true
  }

  const customKeymap = keymap.of([
    {
      key: 'Mod-s',
      run: handleCmdEnter
    }
  ])

  const FetchFileData = async (path) => {
    const res = await fetch(BaseApiUrl + '/api/contents?type=file&hash=0', {
      method: 'POST',

      body: JSON.stringify({
        path
      })
    })
    const resJson = await res.json()
    setFileContents(resJson.content)
    // console.log(resJson['content']);
  }

  useEffect(() => {
    if (props.data.load_required == true) {
      FetchFileData(props.data.path)
    }
  }, [])

  const getExtensionToLoad = () => {
    switch (props.data.extension) {
      case 'go':
      case 'mod':
        return go()
      case 'python':
        return python()
      case 'js':
        return javascript()
      case 'json':
        return json()
      case 'ts':
        return javascript({ jsx: false, typescript: true })
      case 'tsx':
        return javascript({ jsx: true, typescript: true })
      case 'jsx':
        return javascript({ jsx: false, typescript: false })
      case 'html':
        return html()
      case 'css':
        return less()
      case 'sass':
      case 'scss':
        return sass()
      case 'md':
      case 'markdown':
        return markdown({ base: markdownLanguage, codeLanguages: languages })
    }
    return go()
  }
  const [linePosition, setLinePosition] = useAtom(linePositionAtom)
  const [columnPosition, setColumnPosition] = useAtom(columnPositionAtom)
  const [indentationSize, setIndentationSize] = useAtom(indentationSizeAtom)

  const editorRef = useRef<EditorView | null>(null);

  const onUpdate =  useCallback(( viewUpdate: ViewUpdate) => {
    if(viewUpdate){
      const { state } = viewUpdate;
      const position = state.selection.main.head;  

      // Get the line and column based on the absolute position
      const line = state.doc.lineAt(position);  // Get the line info for the cursor position
      const column = position - line.from;  // Calculate the column as an offset from line start
      setLinePosition(line.number)
      setColumnPosition(column)

    }

  }, []);


  return (
    <div className='tab-content'>
      <div className={props.data.active? 'd-block':'d-none'}>
        <div className='editor-body2'>
          <CodeMirror
            value={fileContents}
            theme={theme=='light'? githubLight: githubDark}
            minHeight='100%'
            width='100%'
            extensions={[getExtensionToLoad(), customKeymap, linter(jsonParseLinter())]}
            // linter(esLint(new eslint.Linter(), config)),
            onChange={(fileContents) => {
              setFileContents(fileContents)
            }}
            onUpdate={onUpdate}

            basicSetup={{
              bracketMatching: true,
              highlightActiveLineGutter: true,
              autocompletion: true,
              lintKeymap: true,
              foldGutter: true,
              completionKeymap: true,
              tabSize:indentationSize
            }}
          />
        </div>
      </div>
    </div>
  )
}
