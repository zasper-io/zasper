import Routes from './routes/routes';
import React from 'react';
import { Provider } from 'jotai';

function App() {
  return (
    <Provider>
      <Routes />
    </Provider>
  );
}

export default App;
