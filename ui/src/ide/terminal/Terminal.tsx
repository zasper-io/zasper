import React, { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { AttachAddon } from '@xterm/addon-attach'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { SerializeAddon} from '@xterm/addon-serialize'

import '@xterm/xterm/css/xterm.css'

import { BaseWebSocketUrl } from '../config'
import { useAtom } from 'jotai'
import { themeAtom } from '../../store/Settings'

export default function TerminalTab (props) {

  const [theme] = useAtom(themeAtom)
  const terminalRef = useRef<HTMLDivElement | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const fitAddon = new FitAddon()
  const webLinksAddon = new WebLinksAddon()
  const unicode11Addon = new Unicode11Addon()

  useEffect(() => {
    if (terminalRef.current == null) return
    const xtemBackground = theme === 'light' ? '#392e6b' : '#2b2a2a' 
    // Initialize the terminal
    const terminal = new XTerm({
      theme: {
        background: xtemBackground
      },
      fontFamily: 'Monospace',
      allowProposedApi: true,
    })

    const sendSizeToBackend = (cols: number, rows: number) => {
      // Send the set_size message to the backend with the terminal dimensions
      if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
        const sizeMessage = JSON.stringify({
          type: 'set_size',
          cols: cols,
          rows: rows,
        })
        socketRef.current.send(sizeMessage)
      }
    }

    terminal.loadAddon(fitAddon)
    terminal.loadAddon(webLinksAddon)
    terminal.loadAddon(unicode11Addon)
    terminal.loadAddon(new SerializeAddon())
    terminal.onResize(({ cols, rows }) => {
      console.log('resize', cols, rows)
      // sendSizeToBackend(cols, rows)
    })


    // Attach terminal to DOM
    terminal.open(terminalRef.current)
    fitAddon.fit()
    

    // Connect to the WebSocket server
    socketRef.current = new WebSocket(BaseWebSocketUrl + '/api/terminals/1')
    socketRef.current.binaryType = 'arraybuffer'; // Ensures binary data is treated as arraybuffer 

    socketRef.current.onopen = () => {
      if (socketRef.current !== null) {
        const attachAddon = new AttachAddon(socketRef.current)
        terminal.loadAddon(attachAddon)
        // sendSizeToBackend(terminal.cols, terminal.rows)
      }
    }

    return () => {
      // Clean up on component unmount
      socketRef.current?.close()
      terminal.dispose()
    }
  }, [])

  return (

    <div className='tab-content'>
      <div className={props.data.active? 'd-block':'d-none'}>
        <div ref={terminalRef} className='terminalArea' />
      </div>

    </div>

  )
}
