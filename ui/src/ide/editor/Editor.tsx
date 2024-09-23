
import React, { useEffect, useState } from 'react'

import FileEditor from './FileEditor'
import Launcher from './Launcher'
import NotebookEditor from './NotebookEditor'
import TerminalTab from '../terminal/Terminal'

export default function Editor (props) {
  if (props.data.type === 'launcher') {
    return <Launcher data={props.data} sendDataToParent={props.sendDataToParent} />
  }
  if (props.data.type === 'file') {
    return <FileEditor data={props.data} />
  }
  if (props.data.type === 'notebook') {
    return <NotebookEditor data={props.data} />
  }
  if (props.data.type === 'terminal') {
    return <TerminalTab data={props.data} />
  }
  return <></>
}
