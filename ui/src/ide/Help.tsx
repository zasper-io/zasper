import React from 'react';


interface ModalProps {
    toggleHelpDialog: any,
}

function HelpDialog(props: ModalProps) {


    return (
        <div className="modal" id="exampleModal" aria-labelledby="exampleModalLabel" aria-hidden="true">
            <div className="modal-dialog modal-dialog-centered">
                <div className="modal-content">
                    <div className='modal-head'>
                        Help
                        <button type="button" className="modal-btn-close" aria-label="Close" onClick={props.toggleHelpDialog}> <i className="fas fa-times-circle"></i> </button>
                    </div>
                    <div className="modal-body">
                        <div className='help-section'>  
                            <h6>Zasper is a supercharged IDE for Data Science.</h6>
                            <h6> Version: 0.0.1</h6>
                            <h6>Author: Prasun Anand</h6>
                            <a href='https://zasper.io/docs' target='_blank'>Docs</a>
                        </div>
                    </div>
                </div>
            </div>
        </div>);
}


export default HelpDialog;