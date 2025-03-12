import React from 'react';

function CellButtons(props) {
  return (
    <div className="cellOptionsDiv">
      <div className="cellOptions">
        <button
          type="button"
          className="editor-button"
          onClick={() => props.submitCell(props.code, props.cellId)}
        >
          <i className="fas fa-play" />
        </button>
        <button type="button" className="editor-button" onClick={() => props.copyCell(props.index)}>
          <i className="fas fa-copy" />
        </button>
        <button type="button" className="editor-button" onClick={() => props.nextCell(props.index)}>
          <i className="fas fa-forward" />
        </button>
        <button type="button" className="editor-button" onClick={() => props.prevCell(props.index)}>
          <i className="fas fa-backward" />
        </button>
        <button type="button" className="editor-button" onClick={() => props.addCellUp()}>
          <i className="fas fa-plus" />
        </button>
        <button type="button" className="editor-button" onClick={() => props.addCellDown()}>
          <i className="fas fa-plus" />
        </button>
        <button
          type="button"
          className="editor-button"
          onClick={() => props.deleteCell(props.index)}
        >
          <i className="fas fa-trash" />
        </button>
      </div>
    </div>
  );
}

export default CellButtons;
