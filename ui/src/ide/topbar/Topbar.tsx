import React, { useState, useEffect } from 'react'

export default function Topbar (props) {
  const [directory, setDirectory] = useState('');
  const [output, setOutput] = useState('');

  const handleSelectDirectory = async () => {
    const result = await window.api.openDirectory();
    if (result.length > 0) {
      setDirectory(result[0]);
      await window.api.runCommand(result[0]);
      setOutput(`Selected Directory: ${result[0]}`);
    }
  };


  return (
    <div className='topBar'>

      <div className='container-fluid'>
        <div className='row'>
          <div className='col-3'>
            <img className='logo-white' src='./images/logo-white.svg' alt='#' />
          </div>
          <div className='col-9'>
            <div className='searchArea'>
              <div className='search-wraper'>
                <input type='text' name='search' placeholder='Type your search here' />
                <img src='./images/icons/search.svg' alt='#' />
              </div>
              <div>
                <h1>Select a Directory</h1>
                <button onClick={handleSelectDirectory}>Select Directory</button>
                <pre>{output}</pre>
              </div>

              
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
