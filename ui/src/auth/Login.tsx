import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast, ToastContainer } from 'react-toastify';
import { ApiError, login } from '@/api';
import { useAppCommands } from '@/commands/appCommands';
import { useRegisterCommands } from '@/commands/registry';
import { useCommandKeymap } from '@/commands/useCommandKeymap';
import { Icon } from '@/ide/icons';
import { useApplyZoom } from '@/zoom/useApplyZoom';
import './Login.scss';

function failureMessage(status: number): string {
  switch (status) {
    case 401:
      return 'That token was not accepted. Copy it again from the terminal where Zasper is running.';
    case 403:
      return 'Account is not activated.';
    case 500:
      return 'Internal server error.';
    default:
      return 'Unknown error.';
  }
}

function Login() {
  const navigate = useNavigate();

  // Cmd +/-/0, as in the IDE: the zoom commands, the one dispatcher, and the effect that applies them.
  useCommandKeymap();
  useRegisterCommands(useAppCommands());
  useApplyZoom();

  useEffect(() => {
    const token = localStorage.getItem('token'); // Or your auth key
    if (token) {
      navigate('/', { replace: true });
    }
  }, [navigate]);

  const [accessToken, setAccessToken] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const data = await login(accessToken);
      toast.success('Login successful');
      localStorage.setItem('token', data.token); // store for auth headers
      navigate(data.redirect_path);
    } catch (err) {
      setError(failureMessage(err instanceof ApiError ? err.status : 0));
    }
    setAccessToken('');
  };

  return (
    <div className="login-root">
      <section className="login-page">
        <div className="login-hero">
          <Link to="/" className="login-hero-brand">
            <img className="login-hero-logo" src="./images/logo-white.svg" alt="Zasper" />
          </Link>
          <div className="login-hero-body">
            <p className="login-hero-title">High-performance IDE, inspired by Jupyter.</p>
            <TextCarousel />
          </div>
          <p className="login-hero-foot">
            Open source on{' '}
            <a href="https://github.com/zasper-io/zasper" target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
          </p>
        </div>

        <div className="login-panel">
          <form className="login-form" onSubmit={submitLogin}>
            <h1 className="login-form-title">Sign in</h1>
            <p className="login-form-lede">
              This server is running in protected mode. Enter its access token to open your
              workspace.
            </p>
            {error !== null && (
              <div className="z-notice z-notice-error" role="alert">
                <Icon name="circle-alert" />
                <p>{error}</p>
              </div>
            )}
            <label htmlFor="accessToken">Server access token</label>
            <div className="login-field">
              <input
                id="accessToken"
                type={revealed ? 'text' : 'password'}
                name="password"
                placeholder="Paste the token"
                autoComplete="current-password"
                aria-describedby="accessToken-help"
                // Controlled, so a rejected token is cleared rather than left in the box.
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
              />
              <button
                type="button"
                className="z-icon-button"
                aria-label="Show token"
                aria-pressed={revealed}
                onClick={() => setRevealed(!revealed)}
              >
                <Icon name={revealed ? 'eye-off' : 'eye'} />
              </button>
            </div>
            <p className="z-form-help" id="accessToken-help">
              Printed in the terminal where Zasper is running, on the line{' '}
              <code>Server Access Token</code>.
            </p>
            <button type="submit">
              Sign in <Icon name="arrow-right" />
            </button>
          </form>
          <footer className="login-panel-foot">
            <nav>
              <a href="https://zasper.io/docs" target="_blank" rel="noopener noreferrer">
                Documentation
              </a>
              <a
                href="https://github.com/zasper-io/zasper/issues"
                target="_blank"
                rel="noopener noreferrer"
              >
                Report an issue
              </a>
            </nav>
          </footer>
        </div>
      </section>
      <ToastContainer />
    </div>
  );
}

/**
 * Four sentences, one at a time, on a 10s loop.
 *
 * A list and a keyframe rather than swiper, which was 3.8 MB in node_modules and 88 kB of the login
 * chunk to fade four strings — and which autoplays regardless of `prefers-reduced-motion`, so the one
 * reader who has asked for less movement got the most of it. All four are in the DOM and readable in
 * source order, which is what a screen reader gets either way.
 */
const TextCarousel = () => {
  const texts = [
    'Welcome to Zasper!',
    'Fast, reliable, and secure.',
    'Upto 5X less CPU usage.',
    'Upto 40X less memory usage.',
  ];

  return (
    <ul className="login-slider">
      {texts.map((text, index) => (
        <li className="login-slider-text" key={text} style={{ animationDelay: `${index * 2.5}s` }}>
          {text}
        </li>
      ))}
    </ul>
  );
};

export default Login;
