import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast, ToastContainer } from 'react-toastify';
import { ApiError, login } from '@/api';
import './Login.scss';

function Login() {
  const navigate = useNavigate();

  useEffect(() => {
    const token = localStorage.getItem('token'); // Or your auth key
    if (token) {
      navigate('/', { replace: true });
    }
  }, [navigate]);

  const [form, setForm] = useState({ accessToken: '' });

  const submitLogin = async () => {
    try {
      const data = await login(form.accessToken);
      toast.success('Login successful');
      localStorage.setItem('token', data.token); // store for auth headers
      navigate(data.redirect_path);
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 0;
      if (status === 401) {
        toast.error('Invalid username or password');
      } else if (status === 403) {
        toast.error('Account is not activated');
      } else if (status === 500) {
        toast.error('Internal server error');
      } else {
        toast.error('Unknown error');
      }
    }
    setForm({ accessToken: '' });
  };

  return (
    <section className="login-page">
      {/* The page's own header, and all there was ever a `.navbar` here for: one logo, on the left. */}
      <header className="login-header">
        <Link to="/">
          <img src="./images/logo.svg" alt="Zasper" />
        </Link>
      </header>

      <div className="login-section">
        <div className="login-signup-wraper">
          <div className="login-signup-content">
            <div>
              <div className="login-section-image">
                <img src="./images/header-image.svg" alt="" />
              </div>
              <TextCarousel />
            </div>
          </div>
          <div className="login-signup-form">
            <div className="login-signup-form-wraper">
              <form>
                <label htmlFor="accessToken">Enter Server access token</label>
                <input
                  id="accessToken"
                  type="password"
                  name="password"
                  placeholder="Server Access Token"
                  // Controlled, so that the `setForm` after a failed attempt is a cleared field
                  // rather than state nobody can see: the input had no `value`, and the rejected
                  // token stayed in it.
                  value={form.accessToken}
                  onChange={(e) => setForm({ ...form, accessToken: e.target.value })}
                />
                <button type="button" onClick={submitLogin}>
                  Login
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
      <ToastContainer />
    </section>
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
