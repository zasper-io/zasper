import React, { useEffect } from 'react';
import './Launcher.scss';
import { BaseApiUrl } from '../config';
import { useAtom } from 'jotai';
import { kernelspecsAtom, terminalsCountAtom, terminalsAtom, fileBrowserReloadCountAtom } from '../../store/AppState';

interface LauncherProps {
  data: {
    active: boolean;
  };
  sendDataToParent: (name: string, label: string, type: string, kernelspec: string) => void;
}

const Launcher: React.FC<LauncherProps> = ({ data, sendDataToParent }) => {
  const [kernelspecs, setKernelspecs] = useAtom(kernelspecsAtom);
  const [terminalCount, setTerminalCount] = useAtom(terminalsCountAtom);
  const [terminals, setTerminals] = useAtom(terminalsAtom)
  const [reloadCount, setReloadCount] = useAtom(fileBrowserReloadCountAtom)

  // Fetch kernelspecs from the API
  const fetchData = async () => {
    try {
      const res = await fetch(`${BaseApiUrl}/api/kernelspecs`);
      const resJson = await res.json();
      setKernelspecs(resJson.kernelspecs || {});
    } catch (error) {
      console.error('Error fetching kernelspecs:', error);
    }
  };

  const createNewNotebook = async (path: string, contentType: string, kernelspec: string) => {
    console.log("add file")
    const res = await fetch(BaseApiUrl + '/api/contents/create', {
      method: 'POST',
      body: JSON.stringify({ parent_dir: path, type: contentType }),
    });

    const resJson = await res.json();
    sendDataToParent(resJson.name, resJson.path, 'notebook', kernelspec);
    setReloadCount(reloadCount + 1);
  };

  // Handle opening a new terminal
  const openTerminal = () => {
    console.log('Open terminal');
    const terminalName = "Terminal " + (terminalCount + 1)
    sendDataToParent(terminalName, terminalName, 'terminal', '');
    setTerminalCount(terminalCount + 1)
    var updatedterminals = { ...terminals };
    updatedterminals[terminalName] = { id: terminalName, name: terminalName }
    setTerminals(updatedterminals)
  };

  // Fetch kernelspecs on component mount
  useEffect(() => {
    fetchData();
  }, [setKernelspecs]);

  return (
    <div className={data.active ? 'd-block' : 'd-none'}>
      <div className="LauncherArea">
        <div className="launcher-title">
          <h2 className="font-h3 fontw-300">Welcome to <span className="fontw-500">zasper</span></h2>
        </div>
        <div className='launchSection'>
          <h2 className="font-h5 fontw-300">Notebook</h2>
          {Object.keys(kernelspecs).length > 0 ? (
            Object.keys(kernelspecs).map((key) => (
              <div className="launcher-icon" key={key} onClick={() => createNewNotebook('', 'notebook', kernelspecs[key].name)}>
                <img className='resourceLogoImage' src={`${BaseApiUrl}${kernelspecs[key].resources['logo-svg']}`} alt="logo" />
                <h6>{key}</h6>
              </div>
            ))
          ) : (
            <p>No kernels available.</p>
          )}
        </div>
        
        <div className='launchSection'>
          <h2 className="font-h5 fontw-300">Terminal</h2>
          <div className="launcher-icon" onClick={openTerminal}>
            <img className="terminalIconImage" src="./images/terminal.png" alt="terminal" />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Launcher;
