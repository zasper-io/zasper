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

export default function JupyterInfoPanel({ hidden }: PanelProps) {
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
    <div className={hidden ? 'nav-content is-hidden' : 'nav-content'}>
      <div className="content-head">
        <div className="z-label">Jupyter info</div>
      </div>
      {/* One scroll area for the panel, not one per group. */}
      <div className="content-inner">
        <h2 className="z-subheading panel-section-head">Kernelspecs</h2>
        <ul className="file-list list-unstyled noborder-list">
          {Object.keys(kernelspecs).length > 0 ? (
            Object.keys(kernelspecs).map((key) => (
              // `display_name`, as the launcher shows for the same kernels; the id goes
              // in the title so the two views don't look like different kernels.
              <li className="fileItem" key={key} title={kernelspecs[key].name}>
                {kernelspecs[key].spec.display_name}
              </li>
            ))
          ) : (
            <p>No kernelspecs available.</p>
          )}
        </ul>

        <h2 className="z-subheading panel-section-head">Kernels</h2>
        <ul className="file-list list-unstyled noborder-list">
          {Object.keys(kernels).length > 0 ? (
            Object.keys(kernels).map((key) => (
              <li className="fileItem jupyter-info-row" key={key}>
                <span className="jupyter-info-row-name">
                  {kernelspecs[kernels[key].name]?.spec.display_name ?? kernels[key].name}
                </span>
                <button className="btn btn-danger btn-sm" onClick={() => killKernel(key)}>
                  Kill
                </button>
              </li>
            ))
          ) : (
            <p>No kernels running.</p>
          )}
        </ul>

        <h2 className="z-subheading panel-section-head">Terminals</h2>
        <ul className="file-list list-unstyled noborder-list">
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
  );
}
