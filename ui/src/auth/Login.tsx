import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast, ToastContainer } from 'react-toastify';
import { ApiError, login } from '../api';
import './Login.scss';
import { Swiper, SwiperSlide } from 'swiper/react';
import 'swiper/css';
import 'swiper/css/autoplay';
import { Autoplay } from 'swiper/modules';

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
    <div>
      <section id="header-login-signup">
        <nav className="navbar navbar-expand-lg">
          <div className="container">
            <Link className="navbar-brand" to="/">
              <img src="./images/logo.svg" alt="#" />
            </Link>
          </div>
        </nav>

        <div className="login-section">
          <div className="container">
            <div className="row">
              <div className="col-12">
                <div className="login-signup-wraper">
                  <div className="login-signup-content">
                    <div>
                      <div className="login-section-image">
                        <img src="./images/header-image.svg" alt="#" />
                      </div>
                      <div className="login-signup-content-slider">
                        <TextCarousel />
                      </div>
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
            </div>
          </div>
        </div>
        <ToastContainer />
      </section>
    </div>
  );
}

const TextCarousel = () => {
  const texts = [
    'Welcome to Zasper!',
    'Fast, reliable, and secure.',
    'Upto 5X less CPU usage.',
    'Upto 40X less memory usage.',
  ];

  return (
    <div className="mx-auto">
      <Swiper
        modules={[Autoplay]}
        spaceBetween={20}
        slidesPerView={1}
        loop
        autoplay={{ delay: 2500, disableOnInteraction: false }}
      >
        {texts.map((text, index) => (
          <SwiperSlide key={index}>
            <div className="login-slider-text">{text}</div>
          </SwiperSlide>
        ))}
      </Swiper>
    </div>
  );
};

export default Login;
