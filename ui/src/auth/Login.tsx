import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast, ToastContainer } from 'react-toastify';
import { ApiError, login } from '@/api';
import { isSignedIn, markSignedIn, markSignedOut } from './signedIn';
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

/** Why the server sent this browser here, from `/login?reason=`; null for a first visit. */
function endedMessage(reason: string | null, hadSession: boolean): [string, string?] | null {
  switch (reason) {
    case 'restarted':
      return [
        'Zasper restarted, so your session ended.',
        'The server printed a new token when it started.',
      ];
    case 'expired':
      return ['Your session expired after 24 hours.'];
    case 'signed-out':
      return ['This session was signed out, possibly in another window.'];
    default:
      return hadSession ? ['Your session has ended.'] : null;
  }
}

function Login() {
  const navigate = useNavigate();

  // Cmd +/-/0, as in the IDE: the zoom commands, the one dispatcher, and the effect that applies them.
  useCommandKeymap();
  useRegisterCommands(useAppCommands());
  useApplyZoom();

  const [searchParams] = useSearchParams();
  // Read before the effect below clears it.
  const [hadSession] = useState(isSignedIn);
  const ended = endedMessage(searchParams.get('reason'), hadSession);

  // The server sends a live session away from /login, so a marker still here is stale.
  useEffect(() => {
    markSignedOut();
  }, []);

  const [accessToken, setAccessToken] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const data = await login(accessToken);
      toast.success('Login successful');
      markSignedIn();
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
            <p className="login-hero-title">High-performance IDE for Jupyter Notebooks.</p>
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
            {ended !== null && error === null && (
              <div className="z-notice" role="status">
                <Icon name="info" />
                <p>
                  <strong>{ended[0]}</strong>
                  {ended[1] && ` ${ended[1]}`}
                </p>
              </div>
            )}
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
