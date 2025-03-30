import { useAtom } from 'jotai';
import React from 'react';
import { kernelsAtom, kernelspecsAtom, terminalsAtom } from '../../../store/AppState';
import './JupyterInfoPanel.scss';
import { BaseApiUrl } from '../../config';

export default function JupyterInfoPanel({ display }) {
  const [kernelspecs] = useAtom(kernelspecsAtom);
  const [kernels] = useAtom(kernelsAtom);
  const [terminals] = useAtom(terminalsAtom);

  function killKernel(id) {
    fetch(BaseApiUrl + '/api/kernels/' + id, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
    })
      .then((response) => {
        if (response.ok) {
          console.log('Kernel killed');
          // sendDataToParentsendDataToParent('kernels');
        } else {
          console.log('Failed to kill kernel');
        }
      })
      .catch((error) => {
        console.error('Error:', error);
      });
  }

  return (
    <div className={display}>
      <div className="nav-content">
        <div className="content-head">
          <div>JUPYTER INFO</div>
        </div>
        <div className="projectBanner">
          <div className="projectName">
            <div>Kernelspecs</div>
          </div>
        </div>
        <div className="jupyter-info-commit-content">
          <ul className="file-list list-unstyled">
            {Object.keys(kernelspecs).length > 0 ? (
              Object.keys(kernelspecs).map((key) => (
                <li className="fileItem" key={key}>
                  {kernelspecs[key].name}
                </li>
              ))
            ) : (
              <p>No kernelspecs available.</p>
            )}
          </ul>
        </div>
        <div className="projectBanner">
          <div className="projectName">
            <div>Kernels</div>
          </div>
        </div>
        <div className="jupyter-info-commit-content">
          <ul className="file-list list-unstyled">
            {Object.keys(kernels).length > 0 ? (
              Object.keys(kernels).map((key) => (
                <li className="fileItem" key={key}>
                  {kernels[key].name}
                  <button
                    className="btn btn-danger btn-sm"
                    onClick={() => killKernel(kernels[key].id)}
                  >
                    Kill
                  </button>
                </li>
              ))
            ) : (
              <p>No kernels running.</p>
            )}
          </ul>
        </div>
        <div className="projectBanner">
          <div className="projectName">
            <div>Terminals</div>
          </div>
        </div>
        <div className="jupyter-info-commit-content">
          <ul className="file-list list-unstyled">
            {Object.keys(terminals).length > 0 ? (
              Object.keys(terminals).map((key) => (
                <li className="fileItem" key={key}>
                  {terminals[key].name}
                </li>
              ))
            ) : (
              <p>No terminals running.</p>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
