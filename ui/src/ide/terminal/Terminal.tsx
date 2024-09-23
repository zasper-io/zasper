import React, { useState, useEffect, useRef } from 'react'
import { Terminal as XTerm } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { AttachAddon } from 'xterm-addon-attach'
import { WebLinksAddon } from 'xterm-addon-web-links'

import 'xterm/css/xterm.css'
import { BaseApiUrl, BaseWebSocketUrl } from '../config'

export default function TerminalTab (props) {
  interface IClient {
    send: any
  }

  const listAllTerminals = () => {
    // Simple GET request using fetch
    fetch(BaseApiUrl + '/api/terminals/')
      .then(async response => await response.json())
      .then(
        (data) => {
          console.log('data')
          console.log(data)
        },
        (error) => {
          console.log('error')
        }

      )
  }

  const createTerminal = () => {
    // Simple GET request using fetch
    fetch(BaseApiUrl + '/api/terminals', {
      method: 'POST'
    })
      .then(async response => await response.json())
      .then(
        (data) => {
          console.log('data')
          console.log(data)
        },
        (error) => {
          console.log('error')
        }

      )
  }

  const terminalRef = useRef<HTMLDivElement | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const fitAddon = new FitAddon()
  const webLinksAddon = new WebLinksAddon()

  useEffect(() => {
    if (terminalRef.current == null) return

    // Initialize the terminal
    const terminal = new XTerm({
      theme: {
        background: '#392e6b'
      },
      fontFamily: 'Monospace'
    })

    terminal.loadAddon(fitAddon)
    terminal.loadAddon(webLinksAddon)

    // Attach terminal to DOM
    terminal.open(terminalRef.current)
    fitAddon.fit()

    // Connect to the WebSocket server
    socketRef.current = new WebSocket(BaseWebSocketUrl + '/api/terminals/1')

    socketRef.current.onopen = () => {
      if (socketRef.current !== null) {
        const attachAddon = new AttachAddon(socketRef.current)
        terminal.loadAddon(attachAddon)
      }
    }

    // socketRef.current.onmessage = (event: MessageEvent) => {
    //     terminal.write(event.data);
    // };

    // terminal.onData((data: string) => {
    //     socketRef.current?.send(data);
    // });

    return () => {
      // Clean up on component unmount
      socketRef.current?.close()
      terminal.dispose()
    }
  }, [])

  return (

    <div className='tab-content'>
      <div className={props.data.display}>
        <div ref={terminalRef} className='terminalArea' />
      </div>

    </div>

  )
}
