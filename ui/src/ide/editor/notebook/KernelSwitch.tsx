import React, { useState } from 'react';
import './KernelSwitch.scss';
import { useAtom } from 'jotai';
import { IKernelspec, IKernelspecsState, kernelspecsAtom } from '../../../store/AppState';


interface ModalProps {
    toggleKernelSwitcher: any,
    kernelName: string,
    changeKernel: any
}

function KernelSwitcher(props: ModalProps) {

    const [kernelspecs, setKernelspecs] = useAtom<IKernelspecsState>(kernelspecsAtom);

    const handlekernelSave = () => {
        props.toggleKernelSwitcher();
    }

    return (
        <div className="modal" id="exampleModal" aria-labelledby="exampleModalLabel" aria-hidden="true">
            <div className="modal-dialog modal-dialog-centered">
                <div className="modal-content">
                    <div className='modal-head'>
                        Change Kernel
                        <button type="button" className="modal-btn-close" aria-label="Close" onClick={props.toggleKernelSwitcher}> <i className="fas fa-times-circle"></i> </button>
                    </div>
                    <div className="modal-body">
                        <div className="update-kernel-popup">
                            <div className="update-kernel-popup-right">
                                
                                <p>Current Kernel : {props.kernelName}</p>
                                <div className="update-kernel-popup-form">
                                <select onChange={e => props.changeKernel(e.target.value)} className="form-select editor-select" value={props.kernelName}>
                                    {Object.keys(kernelspecs).map((option, index) => (
                                        <option key={index} value={kernelspecs[option].name}>{kernelspecs[option].name}</option>
                                    ))}
                                </select>
                                    <button className='gitbutton' onClick={props.changeKernel}>Change Kernel</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>);
}


export default KernelSwitcher;