import React, { useState, useEffect } from 'react'

export default function SecretsPanel ({ sendDataToParent, display }) {
  return (
    <div className={display}>
      <div className='nav-content'>
        <div className='content-head'>
          <h6>Secrets</h6>
        </div>
        <div className='content-inner' />
      </div>
    </div>

  )
}
