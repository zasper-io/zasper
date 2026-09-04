import React, { useState } from 'react';
import { useAtom } from 'jotai';
import { IKernelspecsState, kernelspecsAtom } from '@/store/AppState';
import { NO_KERNEL } from './useKernelSession';

interface ModalProps {
  toggleKernelSwitcher: () => void;
  kernelName: string;
  /** Why the last kernel failed to start, '' when this is an ordinary switch. */
  error: string;
  changeKernel: (kernel: string) => void;
}

function KernelSwitcher(props: ModalProps) {
  const [kernelspecs] = useAtom<IKernelspecsState>(kernelspecsAtom);

  const [selectedKernel, setSelectedKernel] = useState(
    Object.keys(kernelspecs).length >= 1
      ? Object.values(kernelspecs)[0].name // Auto-select if only one kernel
      : props.kernelName
  );

  const hasError = props.error !== '';
  const title = hasError
    ? 'Kernel Error'
    : props.kernelName === NO_KERNEL
      ? 'Select Kernel'
      : 'Switch Kernel';

  return (
    <div className="modal" id="exampleModal" aria-labelledby="exampleModalLabel">
      <div className="modal-dialog modal-dialog-centered">
        <div className="modal-content">
          {/* Red-headed when this was raised by a failure rather than asked for. */}
          <div className={hasError ? 'modal-head error-head' : 'modal-head'}>
            {title}
            <button
              type="button"
              className="modal-btn-close"
              aria-label="Close"
              onClick={props.toggleKernelSwitcher}
            >
              {' '}
              <i className="fas fa-times-circle"></i>{' '}
            </button>
          </div>
          <div className="modal-body">
            {hasError && (
              <div className="update-kernel-popup modal-error" role="alert">
                <p>
                  The kernel could not be started. Pick another one below.
                  <br />
                  {props.error}
                </p>
              </div>
            )}
            <div className="update-kernel-popup">
              <div className="update-kernel-popup-right">
                <p>Current Kernel : {props.kernelName}</p>
                <div className="update-kernel-popup-form">
                  <select
                    onChange={(e) => setSelectedKernel(e.target.value)}
                    className="editor-select"
                    value={selectedKernel}
                  >
                    {Object.keys(kernelspecs).map((option, index) => (
                      <option key={index} value={kernelspecs[option].name}>
                        {kernelspecs[option].name}
                      </option>
                    ))}
                  </select>
                  <button className="z-button" onClick={() => props.changeKernel(selectedKernel)}>
                    {props.kernelName === NO_KERNEL ? 'Select Kernel' : 'Switch Kernel'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default KernelSwitcher;
