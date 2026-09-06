import { createRoot } from 'react-dom/client';
// Before styles/index.scss, and here rather than in the two components that render a ToastContainer.
// The library declares its 38 --toastify-* variables at :root, and styles/_overlays.scss answers
// fourteen of them at :root too, so which of the two wins is the order they are imported in. It also
// fixes /login, which rendered a ToastContainer in a chunk that carried none of this CSS.
import 'react-toastify/dist/ReactToastify.css';
import './styles/index.scss';
import App from './App';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Root container #root is missing from index.html');
}

createRoot(container).render(<App />);
