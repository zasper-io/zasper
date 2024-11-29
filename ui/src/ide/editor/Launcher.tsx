import React, { useEffect } from 'react';
import './Launcher.scss';
import { BaseApiUrl } from '../config';
import { atom, useAtom } from 'jotai';
import { kernelspecsAtom } from '../../store/AppState';



interface LauncherProps {
  data: {
    active: boolean;
  };
  sendDataToParent: (name: string, label: string, type: string) => void;
}

const Launcher: React.FC<LauncherProps> = ({ data, sendDataToParent }) => {
  const [kernelspecs, setKernelspecs] = useAtom(kernelspecsAtom);

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

  // Handle opening a new terminal
  const openTerminal = () => {
    console.log('Open terminal');
    sendDataToParent('Terminal 1', 'Terminal 1', 'terminal');
  };

  // Fetch kernelspecs on component mount
  useEffect(() => {
    fetchData();
  }, [setKernelspecs]);

  return (
    <div className={data.active? 'd-block':'d-none'}>
      <div className="LauncherArea">
        <h2 className="launchItem">Notebook</h2>
        {Object.keys(kernelspecs).length > 0 ? (
          Object.keys(kernelspecs).map((key) => (
            <div className="launcher-icon" key={key}>
              <h6>{key}</h6>
              <img src={kernelspecs[key].resources['logo-64x64']} alt="logo" />
            </div>
          ))
        ) : (
          <p>No kernels available.</p>
        )}
        <hr />
        <h2 className="launchItem">Terminal</h2>
        <div className="launcher-icon" onClick={openTerminal}>
          <h6>New Terminal</h6>
          <img className="terminalIconImage" src="./images/terminal.png" alt="terminal" />
        </div>
      </div>
    </div>
  );
};

export default Launcher;
