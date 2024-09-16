
import React, { useEffect, useState } from 'react';

import CodeMirror from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { BaseApiUrl } from '../config';

import "./FileTab.scss"

export default function FileTab(props) {
    const [fileContents, setFileContents] = useState("");

    const FetchFileData = async (path) => {
        const res = await fetch(BaseApiUrl + "/api/contents?type=notebook&hash=0", {
            method: 'POST',

            body: JSON.stringify({
                path : path
            })
        });
        const resJson = await res.json();
        setFileContents(resJson['content']);
        // console.log(resJson['content']);
    };

    useEffect(() => {
        if(props.data.load_required == true) {
            FetchFileData(props.data.name);
        }
    }, [])


    const createNewFile = async () => {
        const res = await fetch(BaseApiUrl + "/api/contents/", {
            method: 'POST'
        });
    }

    const renameFile = async () => {
        let path = "abc.py";
        const res = await fetch(BaseApiUrl + "/api/contents/untitled", {
            method: 'PATCH',
            body: JSON.stringify({
                path: 'abc.py'
            })
        });
    }

    const onSave = async () => {
        let path = "abc.py";
        alert("Saving file")
        const res = await fetch(BaseApiUrl + "/api/contents/abc.py", {
            method: 'PUT',
            body: JSON.stringify({
                content: fileContents,
                type: 'file',
                format: 'text'
            })
        });
    }

    const deleteFile = async () => {
        let path = "abc.py";
        const res = await fetch(BaseApiUrl + "/api/contents/untitled1", {
            method: 'DELETE'
        });
    }

    return (
        <div className="tab-content">
            <div className={props.data.display}>
                <div className="editor-body2">
                    <CodeMirror
                        value={fileContents}
                        minHeight='100%'
                        width='100%'
                        extensions={[python()]}
                        onChange={(fileContents) => {
                            setFileContents(fileContents);
                        }}
                    />
                </div>
            </div>
        </div>
    )
}


