import { useAtom } from 'jotai';
import React from 'react';
import {
  kernelsAtom,
  kernelspecsAtom,
  notebookKernelMapAtom,
  terminalsAtom,
} from '@/store/AppState';
import './JupyterInfoPanel.scss';
import { deleteKernel } from '@/api';
import { PanelProps } from '../types';

export default function JupyterInfoPanel({ display }: PanelProps) {
  const [kernelspecs] = useAtom(kernelspecsAtom);
  const [kernels, setKernels] = useAtom(kernelsAtom);
  const [terminals] = useAtom(terminalsAtom);
  const [, setNotebookKernelMap] = useAtom(notebookKernelMapAtom);

  function killKernel(key: string) {
    const id = kernels[key].id;
    deleteKernel(id)
      .then(() => {
        setKernels((prevKernels) => {
          const updatedKernels = { ...prevKernels };
          delete updatedKernels[key];
          return updatedKernels;
        });
        // Notebooks bound to this kernel would otherwise keep pointing at it and
        // silently send execute requests to a dead kernel.
        setNotebookKernelMap((prev) =>
          Object.fromEntries(Object.entries(prev).filter(([, kernel]) => kernel.id !== id))
        );
      })
      .catch((error) => {
        console.error('Failed to kill kernel', error);
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
                  <button className="btn btn-danger btn-sm" onClick={() => killKernel(key)}>
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
