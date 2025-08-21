import React, { useEffect, useState, useRef } from 'react';

// Types for Jupyter messages we care about
interface JupyterMessage {
  msg_type: string;
  content: any;
}

interface WidgetRendererProps {
  modelId: string;
  connection: {
    send: (msg: JupyterMessage) => void;
    onMessage: (callback: (msg: JupyterMessage) => void) => () => void; // returns unsubscribe
  };
}

interface WidgetState {
  _model_name?: string;
  value?: number;
  min?: number;
  max?: number;
  [key: string]: any;
}

export const WidgetRenderer: React.FC<WidgetRendererProps> = ({ modelId }) => {
  const [state, setState] = useState<WidgetState | null>(null);
  const commIdRef = useRef<string>(modelId);

  //   useEffect(() => {
  //     const handleMsg = (msg: JupyterMessage) => {
  //       const { msg_type, content } = msg;

  //       if (msg_type === 'comm_open' && content.comm_id === commIdRef.current) {
  //         setState(content.data.state || {});
  //       } else if (msg_type === 'comm_msg' && content.comm_id === commIdRef.current) {
  //         setState((prev) => ({ ...(prev || {}), ...content.data.state }));
  //       } else if (msg_type === 'comm_close' && content.comm_id === commIdRef.current) {
  //         setState(null);
  //       }
  //     };

  //     const unsubscribe = connection.onMessage(handleMsg);
  //     return () => unsubscribe();
  //   }, [connection]);

  const sendUpdate = (newValue: number) => {
    setState((prev) => ({ ...(prev || {}), value: newValue }));
    // connection.send({
    //   msg_type: 'comm_msg',
    //   content: {
    //     comm_id: commIdRef.current,
    //     data: { state: { value: newValue } },
    //   },
    // });
  };

  if (!state) {
    return <div>Loading widget...</div>;
  }

  if (state._model_name === 'IntSliderModel') {
    return (
      <div>
        <input
          type="range"
          min={state.min ?? 0}
          max={state.max ?? 100}
          value={state.value ?? 0}
          onChange={(e) => sendUpdate(parseInt(e.target.value, 10))}
        />
        <span>{state.value}</span>
      </div>
    );
  }

  return <div>Unsupported widget type: {state._model_name}</div>;
};
