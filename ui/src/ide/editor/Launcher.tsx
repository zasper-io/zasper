import React from 'react';
import './Launcher.scss';
import { BaseApiUrl } from '@/config';
import { ContentType, createContent } from '@/api';
import { useAtom, useAtomValue } from 'jotai';
import {
  kernelspecsAtom,
  kernelspecsStatusAtom,
  fileBrowserReloadCountAtom,
} from '@/store/AppState';
import { useTabActions } from '@/store/TabActions';
import { useKernelspecActions } from '@/store/KernelspecActions';
import { Icon } from '../icons';

interface LauncherProps {
  data: {
    active: boolean;
  };
}

const Launcher: React.FC<LauncherProps> = ({ data }) => {
  // Read on boot by IDE.tsx, not here: the Jupyter info panel wants the same list, and a list fetched
  // by whichever tab is open is one that is missing when that tab is not. The status is what an empty
  // list cannot say — before the read, and after one that failed, there are no kernels either way.
  const kernelspecs = useAtomValue(kernelspecsAtom);
  const status = useAtomValue(kernelspecsStatusAtom);
  const [reloadCount, setReloadCount] = useAtom(fileBrowserReloadCountAtom);
  const { openTab, openTerminal } = useTabActions();
  const { loadKernelspecs } = useKernelspecActions();

  const createNewNotebook = async (path: string, contentType: ContentType, kernelspec: string) => {
    const created = await createContent(path, contentType);
    openTab({ name: created.name, path: created.path, type: 'notebook', kernelspec });
    setReloadCount(reloadCount + 1);
  };

  const getLogoUrl = (resources: Record<string, string>) => {
    const logoPath = resources['logo-svg'] || resources['logo-64x64'] || resources['logo-32x32'];
    return `${BaseApiUrl}${logoPath}`;
  };

  return (
    <div className="LauncherArea">
      {/* The type scale comes from styles/_typography.scss. */}
      <div className="launcher-title">
        <h2 className="z-title">
          Welcome to <strong>zasper</strong>
        </h2>
      </div>
      <div className="launchSection">
        <h2 className="z-heading">Notebook</h2>
        {status === 'loading' ? (
          <p className="z-note">
            <span className="z-spinner" />
            Looking for installed kernels…
          </p>
        ) : status === 'failed' ? (
          <KernelspecsUnavailable onRetry={loadKernelspecs} />
        ) : Object.keys(kernelspecs).length > 0 ? (
          <div className="launchSection-grid">
            {Object.keys(kernelspecs).map((key) => (
              <button
                type="button"
                className="launcher-icon"
                key={key}
                onClick={() => createNewNotebook('', 'notebook', kernelspecs[key].name)}
              >
                <div className="kernelSpecIconArea">
                  {/* The one picture on screen from outside the icon set, and it stays: a kernel's
                      logo is its identity. `alt=""` because the name is under it. */}
                  <img src={getLogoUrl(kernelspecs[key].resources)} alt="" />
                </div>
                <div className="launcher-icon-label">{kernelspecs[key].spec.display_name}</div>
              </button>
            ))}
          </div>
        ) : (
          <NoKernelsFound onRetry={loadKernelspecs} />
        )}
      </div>

      <div className="launchSection">
        <h2 className="z-heading">Terminal</h2>
        <div className="launchSection-grid">
          <button type="button" className="launcher-icon" onClick={() => openTerminal()}>
            {/* Sized to 44px in CSS, beside the kernel logos: a tile is one row of one grid. */}
            <Icon name="terminal" />
            <div className="launcher-icon-label">Terminal</div>
          </button>
        </div>
      </div>
    </div>
  );
};

interface NoticeProps {
  onRetry: () => void;
}

// A notice rather than a tile, because there is nothing here to click. No glyph in the heading: the
// `❌` that was here was the app's last emoji standing in for an icon, and a red mark beside a
// sentence beginning "No kernels available" is the sentence twice.
const NoKernelsFound: React.FC<NoticeProps> = ({ onRetry }) => {
  return (
    <div className="noKernelsFound">
      <h3 className="z-subheading">No kernels available</h3>
      <p>Zasper found no Jupyter kernel to run a notebook on. Install one:</p>
      <code>pip install ipykernel</code>
      <p>
        Then check again, or read{' '}
        <a
          href="https://zasper.io/docs/installing-jupyter-kernels"
          target="_blank"
          rel="noreferrer"
        >
          installing Jupyter kernels
        </a>
        .
      </p>
      <button type="button" className="z-button z-button-secondary" onClick={onRetry}>
        Check again
      </button>
    </div>
  );
};

// The same box, and a different sentence: nothing is known about the kernels here, which is not the
// same as knowing there are none.
const KernelspecsUnavailable: React.FC<NoticeProps> = ({ onRetry }) => {
  return (
    <div className="noKernelsFound">
      <h3 className="z-subheading">Could not read the installed kernels</h3>
      <p>
        Zasper could not reach the server to ask which kernels are installed. There may be kernels
        here; this window does not know.
      </p>
      <button type="button" className="z-button z-button-secondary" onClick={onRetry}>
        Check again
      </button>
    </div>
  );
};

export default Launcher;
