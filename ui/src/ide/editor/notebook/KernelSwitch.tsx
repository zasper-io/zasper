import React, { useState } from 'react';
import { useAtom } from 'jotai';
import { Icon } from '@/ide/icons';
import { useDismissOnEscape } from '@/ide/overlays';
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

  // The kernel already attached, so that confirming the dialog is a no-op rather than a move to
  // whichever kernelspec happens to sort first. This read `length >= 1` and always took the first
  // one — the dialog said "Current Kernel : python3" over a select showing `example`.
  // Only when there is no attached kernel to preselect does a single installed kernelspec win.
  const specNames = Object.keys(kernelspecs);
  const [selectedKernel, setSelectedKernel] = useState(
    // Falling back to the first option rather than to props.kernelName keeps the state and the
    // rendered select in step: a value no <option> carries shows as the first option but submits
    // the placeholder, so "Select Kernel" on a notebook that names none would start nothing.
    () =>
      specNames.includes(props.kernelName) ? props.kernelName : (specNames[0] ?? props.kernelName)
  );

  const currentKernelLabel =
    props.kernelName === NO_KERNEL
      ? 'none'
      : (kernelspecs[props.kernelName]?.spec?.display_name ?? props.kernelName);

  const hasError = props.error !== '';
  const title = hasError
    ? 'Kernel Error'
    : props.kernelName === NO_KERNEL
      ? 'Select Kernel'
      : 'Switch Kernel';

  // Escape leaves the notebook with the kernel it already has, which for a failure to start is none —
  // the toolbar's kernel name is the way back in, so this is a dismissal and not a decision avoided.
  useDismissOnEscape(props.toggleKernelSwitcher);

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="kernelSwitchTitle">
      <div className="modal-dialog modal-dialog-centered">
        <div className="modal-content">
          {/* Red-headed when this was raised by a failure rather than asked for. */}
          <div className={hasError ? 'modal-head error-head' : 'modal-head'} id="kernelSwitchTitle">
            {title}
            <button
              type="button"
              className="z-icon-button on-chrome modal-btn-close"
              aria-label="Close"
              onClick={props.toggleKernelSwitcher}
            >
              {' '}
              <Icon name="x" />{' '}
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
                <p>Current Kernel : {currentKernelLabel}</p>
                <div className="update-kernel-popup-form">
                  <div className="z-form-field">
                    <label className="z-form-label" htmlFor="kernelSwitchSelect">
                      Kernel
                    </label>
                    <div className="z-select">
                      <select
                        id="kernelSwitchSelect"
                        onChange={(e) => setSelectedKernel(e.target.value)}
                        value={selectedKernel}
                      >
                        {specNames.map((option) => (
                          <option key={option} value={kernelspecs[option].name}>
                            {/* The display name is what a reader recognises; the bare id only
                                matches it for kernelspecs that never set one. */}
                            {kernelspecs[option].spec?.display_name ?? kernelspecs[option].name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
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
