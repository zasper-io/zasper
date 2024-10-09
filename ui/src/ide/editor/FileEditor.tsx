
import React, { useEffect, useState } from 'react'

import CodeMirror from '@uiw/react-codemirror'
import { python } from '@codemirror/lang-python'
import { html } from '@codemirror/lang-html'
import { go } from '@codemirror/lang-go'
import { less } from '@codemirror/lang-less'
import { sass } from '@codemirror/lang-sass'
import { javascript } from '@codemirror/lang-javascript'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { keymap } from '@codemirror/view'
import { BaseApiUrl } from '../config'

import './FileEditor.scss'

export default function FileEditor (props) {
  const [fileContents, setFileContents] = useState('')

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

  return (
    <div className='tab-content'>
      <div className={props.data.display}>
        <div className='editor-body2'>
          <CodeMirror
            value={fileContents}
            minHeight='100%'
            width='100%'
            extensions={[getExtensionToLoad(), customKeymap]}
            onChange={(fileContents) => {
              setFileContents(fileContents)
            }}
            basicSetup={{
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
    </div>
  )
}
