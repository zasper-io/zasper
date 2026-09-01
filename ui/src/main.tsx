import { createRoot } from 'react-dom/client';
import App from './App';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Root container #root is missing from index.html');
}

createRoot(container).render(<App />);
