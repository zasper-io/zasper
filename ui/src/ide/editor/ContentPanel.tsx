import React, { useEffect, useState } from 'react'
import Editor from './Editor'

export default function ContentPanel (props) {
  const handleKeyPress = () => {
    alert('Detected Shift+Enter')
    // if (e.key === 'Enter' && e.shiftKey) {

    //     return CodeMirror.Pass;
    // }
  }

  const onChange = React.useCallback((value, viewUpdate) => {
    console.log('value:', value)
  }, [])

  const tabToggle = () => {
  }

  const closeTab = () => {
    alert('Tab close')
  }

  useEffect(() => {
    // listContents();
  }, [])

  return (
    <div className='tabContent'>
      {Object.keys(props.tabs).map((key, index) => (
        <Editor key={index} data={props.tabs[key]} sendDataToParent={props.sendDataToParent} />
      ))}
    </div>
  )
}
