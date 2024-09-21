import React, { useEffect, useState } from 'react';
import "./Launcher.scss"
import { BaseApiUrl } from '../config';

export default function Launcher(props) {

    interface IKernelspec {
        name: string,
        spec: string,
        resources: string
    }

    
    const [kernelspecs, setKernelspecs] = useState({a: {name: "x", spec: "y", resources: "z"}
                                                    });
    
    const FetchData = async () => {
        const res = await fetch(BaseApiUrl + "/api/kernelspecs");
        const resJson = await res.json();
        setKernelspecs(resJson.kernelspecs);
        console.log(resJson.kernelspecs);
    };

    const openTerminal = async() => {
        console.log("open terminal");
        props.sendDataToParent("","Terminal 1", "terminal")
    }

    useEffect(() => {
        FetchData();
    }, []);

    return (

            <div className={props.data.display}>
                <div className='LauncherArea'>
                    <h2>Notebook</h2>
                    {
                        Object.keys(kernelspecs).map((key, index) => ( 
                        <div className='launcher-icon' key={index}>
                            <h6> {key}</h6>
                            <img src={`${kernelspecs[key]["resources"]["logo-64x64"]}`}/>
                        </div> 
                        ))
                    }
                    <hr></hr>
                    <h2>Terminal</h2>
                    <div className='launcher-icon' onClick={openTerminal}>
                        <h6>New Terminal</h6>    
                        <img className="terminalIconImage" src="./images/terminal.png"/>
                    </div>
                </div>
                
            </div>
        )

}
