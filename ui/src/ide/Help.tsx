import React from 'react';
import { zasperVersionAtom } from '../store/AppState';
import { useAtom } from 'jotai';

interface ModalProps {
  toggleHelpDialog: any;
}

function HelpDialog(props: ModalProps) {
  const [zasperVersion] = useAtom(zasperVersionAtom);

  return (
    <div className="modal" id="exampleModal" aria-labelledby="exampleModalLabel" aria-hidden="true">
      <div className="modal-dialog modal-dialog-centered">
        <div className="modal-content">
          <div className="modal-head">
            Help
            <button
              type="button"
              className="modal-btn-close"
              aria-label="Close"
              onClick={props.toggleHelpDialog}
            >
              {' '}
              <i className="fas fa-times-circle"></i>{' '}
            </button>
          </div>
          <div className="modal-body">
            <div className="help-section">
              <h6>Zasper is a supercharged IDE for Data Science.</h6>
              <h6>Version: {zasperVersion}</h6>
              <h6>Author: Prasun Anand</h6>
              <a href="https://zasper.io/docs" target="_blank" rel="noreferrer">
                Docs
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default HelpDialog;
