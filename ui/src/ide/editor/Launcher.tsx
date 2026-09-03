import React, { useEffect, useCallback } from 'react';
import './Launcher.scss';
import { BaseApiUrl } from '@/config';
import { ContentType, createContent, listKernelspecs } from '@/api';
import { useAtom } from 'jotai';
import { kernelspecsAtom, fileBrowserReloadCountAtom } from '@/store/AppState';
import { useTabActions } from '@/store/TabActions';
import { TerminalIcon } from '../icons';

interface LauncherProps {
  data: {
    active: boolean;
  };
}

const Launcher: React.FC<LauncherProps> = ({ data }) => {
  const [kernelspecs, setKernelspecs] = useAtom(kernelspecsAtom);
  const [reloadCount, setReloadCount] = useAtom(fileBrowserReloadCountAtom);
  const { openTab, openTerminal } = useTabActions();

  // Fetch kernelspecs from the API
  const fetchData = useCallback(async () => {
    try {
      setKernelspecs(await listKernelspecs());
    } catch (error) {
      console.error('Error fetching kernelspecs:', error);
    }
  }, [setKernelspecs]);

  const createNewNotebook = async (path: string, contentType: ContentType, kernelspec: string) => {
    const created = await createContent(path, contentType);
    openTab({ name: created.name, path: created.path, type: 'notebook', kernelspec });
    setReloadCount(reloadCount + 1);
  };

  const getLogoUrl = (resources: Record<string, string>) => {
    const logoPath = resources['logo-svg'] || resources['logo-64x64'] || resources['logo-32x32'];
    return `${BaseApiUrl}${logoPath}`;
  };

  // Fetch kernelspecs on component mount
  useEffect(() => {
    fetchData();
  }, [fetchData]);

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
        {Object.keys(kernelspecs).length > 0 ? (
          <div className="launchSection-grid">
            {Object.keys(kernelspecs).map((key) => (
              <div
                className="launcher-icon"
                key={key}
                onClick={() => createNewNotebook('', 'notebook', kernelspecs[key].name)}
              >
                <div className="kernelSpecIconArea">
                  <img
                    className="resourceLogoImage"
                    src={getLogoUrl(kernelspecs[key].resources)}
                    alt="logo"
                  />
                </div>
                <div className="kernelspecDisplayName">{kernelspecs[key].spec.display_name}</div>
              </div>
            ))}
          </div>
        ) : (
          <NoKernelsFound />
        )}
      </div>

      <div className="launchSection">
        <h2 className="z-heading">Terminal</h2>
        <div className="launchSection-grid">
          <div className="launcher-icon" onClick={() => openTerminal()}>
            <TerminalIcon />
          </div>
        </div>
      </div>
    </div>
  );
};

const NoKernelsFound: React.FC = () => {
  return (
    <div className="noKernelsFound">
      <h3 className="z-subheading">❌ No kernels available</h3>
      <p>Please install a kernel to create a new notebook.</p>
      <code>
        pip install ipykernel
        <br />
      </code>
      <p>
        Check docs on our{' '}
        <a
          href="https://zasper.io/docs/installing-jupyter-kernels"
          target="_blank"
          rel="noreferrer"
        >
          website
        </a>
      </p>
    </div>
  );
};

export default Launcher;
