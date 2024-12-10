import React from 'react';

function NbButtons(props){
    
    const options = [
        { label: 'Code', value: 'code' },
        { label: 'Markdown', value: 'markdown' },
        { label: 'Raw', value: 'raw' },
    ]

    const changeCellType = (value) =>{

    }
  
    return (
      <div className='text-editor-tool'>
        <button type='button' className='editor-button' onClick={() => props.saveNotebook()}><i className='fas fa-save' /></button>
        <button type='button' className='editor-button' onClick={() => props.addCell(props.index)}><i className='fas fa-plus' /></button>
        <button type='button' className='editor-button' onClick={() => props.cutCell(props.index)}><i className='fas fa-cut' /></button>
        <button type='button' className='editor-button' onClick={() => props.copyCell(props.index)}><i className='fas fa-copy' /></button>
        <button type='button' className='editor-button' onClick={() => props.pasteCell(props.index)}><i className='fas fa-paste' /></button>
        <button type='button' className='editor-button' onClick={() => props.submitCell(props.index)}><i className='fas fa-play' /></button>
        <button type='button' className='editor-button' onClick={() => props.stopKernel()}><i className='fas fa-square' /></button>
        <button type='button' className='editor-button' onClick={() => props.restartKernel()}><i className='fas fa-redo' /></button>
        <button type='button' className='editor-button' onClick={() => props.reExecuteNotebook()}><i className='fas fa-forward' /></button>
        <select onChange={e => changeCellType(e.target.value)} className="form-select editor-select" value={props.notebook.cells.length > 0 && props.notebook.cells[props.focusedIndex].cell_type}>
            {options.map((option, index) => (
                <option key={index} value={option.value}>{option.label}</option>
            ))}
        </select>
        <div className='ms-auto'>{props.kernelName}</div>
        <div className="kStatus">{props.kernelStatus}</div>
      </div>
    )
  }
export default NbButtons;
