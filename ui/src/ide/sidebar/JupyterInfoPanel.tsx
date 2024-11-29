
import { useAtom } from 'jotai';
import React, { useState, useEffect, useRef } from 'react';
import { kernelspecsAtom } from '../../store/AppState';

export default function JupyterInfoPanel ({ sendDataToParent, display }) {

  const [kernelspecs, setKernelspecs] = useAtom(kernelspecsAtom);

  return (
    <div className={display}>
      <div className='nav-content'>
        <div className='content-head'>
          <h6>Jupyter Info</h6>
        </div>
        <div className='content-inner'>
          <h6>Kernelspecs</h6>
          <ul className='file-list list-unstyled'>
            {Object.keys(kernelspecs).length > 0 ? (
              Object.keys(kernelspecs).map((key) => (
                <li className='fileItem' key={key}>{kernelspecs[key].name}</li>
              ))
            ) : (
              <p>No kernels available.</p>
            )}
          </ul>
          <h6>Kernels</h6>
          <ul className='file-list list-unstyled'>
            <li className='fileItem'>Kernels</li>
          </ul>
          <h6>Terminals</h6>
          <ul className='file-list list-unstyled'>
            <li className='fileItem'>Terminals</li>
          </ul>
        </div>
      </div>
    </div>
  )
}




