import React from 'react';

function NbButtons(props) {
  const options = [
    { label: 'Code', value: 'code' },
    { label: 'Markdown', value: 'markdown' },
    { label: 'Raw', value: 'raw' },
  ];

  return (
    <div className="text-editor-tool">
      <button
        type="button"
        className="editor-button"
        onClick={() => props.saveNotebook()}
        title="Save Notebook"
      >
        <i className="fas fa-save" />
      </button>
      <button
        type="button"
        className="editor-button"
        onClick={() => props.addCellDown()}
        title="Add Cell Below"
      >
        <i className="fas fa-plus" />
      </button>
      <button
        type="button"
        className="editor-button"
        onClick={() => props.cutCell()}
        title="Cut Cell"
      >
        <i className="fas fa-cut" />
      </button>
      <button
        type="button"
        className="editor-button"
        onClick={() => props.copyCell()}
        title="Copy Cell"
      >
        <i className="fas fa-copy" />
      </button>
      <button
        type="button"
        className="editor-button"
        onClick={() => props.pasteCell()}
        title="Paste Cell"
      >
        <i className="fas fa-paste" />
      </button>
      <button
        type="button"
        className="editor-button"
        onClick={() => props.submitCell(props.index)}
        title="Run Cell"
      >
        <i className="fas fa-play" />
      </button>
      <button
        type="button"
        className="editor-button"
        onClick={() => props.interruptKernel()}
        title="Interrupt Kernel"
      >
        <i className="fas fa-square" />
      </button>
      <button
        type="button"
        className="editor-button"
        onClick={() => props.restartKernel()}
        title="Restart Kernel"
      >
        <i className="fas fa-redo" />
      </button>
      <button
        type="button"
        className="editor-button"
        onClick={() => props.restartAndExecuteAllCells()}
        title="Restart Kernel and Execute all Cells"
      >
        <i className="fas fa-forward" />
      </button>
      <select
        onChange={(e) => props.changeCellType(e.target.value)}
        className=" editor-select"
        value={
          props.notebook.cells.length > 0 && props.notebook.cells[props.focusedIndex].cell_type
        }
      >
        {options.map((option, index) => (
          <option key={index} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <div className="ms-auto">
        <button className="editor-button" onClick={props.toggleKernelSwitcher}>
          {props.kernelName}
        </button>
      </div>
      <div className="kStatus">
        <span className={`kernelStatus ks-${props.kernelStatus}`}></span>
        <button className="reconnectButton" onClick={props.reconnectKernel}>
          <img
            src="./images/editor/reconnect-icon.svg"
            title="Reconnect Kernel"
            alt="Reconnect"
          ></img>
        </button>
      </div>
    </div>
  );
}
export default NbButtons;
