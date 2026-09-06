import { createRoot } from 'react-dom/client';
// Before styles/index.scss, and here rather than in the two components that render a ToastContainer.
// The library declares its 38 --toastify-* variables at :root, and styles/_overlays.scss answers
// fourteen of them at :root too, so which of the two wins is the order they are imported in. It also
// fixes /login, which rendered a ToastContainer in a chunk that carried none of this CSS.
import 'react-toastify/dist/ReactToastify.css';
import './styles/index.scss';
import App from './App';
import { applyTheme, storedTheme } from './themes';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Root container #root is missing from index.html');
}

// Before the first render, and for every route rather than for the IDE alone: index.html carries
// `data-theme="light" data-accent="teal"` so that a page always has colours, and this is where they
// become the reader's own. /login has no other way to a theme, and the IDE no longer paints teal for
// the length of a request before repainting.
applyTheme(storedTheme());

createRoot(container).render(<App />);
