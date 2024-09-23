import React, { useState, useEffect } from 'react'

export default function Topbar (props) {
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
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
