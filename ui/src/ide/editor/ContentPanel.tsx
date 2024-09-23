import React, { useEffect, useState } from 'react'
import Editor from './Editor'

export default function ContentPanel (props) {
  return (
    <div className='tabContent'>
      {Object.keys(props.tabs).map((key, index) => (
        <Editor key={index} data={props.tabs[key]} sendDataToParent={props.sendDataToParent} />
      ))}
    </div>
  )
}
