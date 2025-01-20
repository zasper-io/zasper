import React, { useState } from 'react';
import './KernelSwitch.scss';


interface ModalProps {
    toggleKernelSwitcher: any
}

function KernelSwitcher(props: ModalProps) {

    const handlekernelSave = () => {
        props.toggleKernelSwitcher();
    }

    return (
        <div className="modal" id="exampleModal" aria-labelledby="exampleModalLabel" aria-hidden="true">
            <div className="modal-dialog modal-dialog-centered">
                <div className="modal-content">
                    <div className="update-kernel-popup">
                        <div className="update-kernel-popup-left">
                            <div className="update-kernel-popup-image">
                                <img src="/images/kernel.jpg" alt="#" />
                            </div>
                            <button>Change Kernel</button>
                        </div>
                        <div className="update-kernel-popup-right">
                            <button type="button" className="btn-close" aria-label="Close" onClick={props.toggleKernelSwitcher}></button>
                            <div className="popup-title">
                                <h3>Update <span>kernel</span></h3>
                            </div>
                            <div className="update-kernel-popup-form">
                                <form>
                                    
                                </form>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>);
}


export default KernelSwitcher;