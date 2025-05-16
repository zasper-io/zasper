import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast, ToastContainer } from 'react-toastify';
import { BaseApiUrl } from '../ide/config';
import './Login.scss';
import { Swiper, SwiperSlide } from 'swiper/react';
import 'swiper/css';
import 'swiper/css/autoplay';
import { Autoplay } from 'swiper/modules';

function Login(props: any) {
  const navigate = useNavigate();

  useEffect(() => {
    const token = localStorage.getItem('token'); // Or your auth key
    if (token) {
      navigate('/', { replace: true });
    }
  }, [navigate]);

  const [form, setForm] = useState({ accessToken: '' });

  const submitLogin = async () => {
    const body = JSON.stringify(form);
    const res = await fetch(BaseApiUrl + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    if (res.status === 200) {
      toast.success('Login successful');
      const data = await res.json();
      localStorage.setItem('token', data.token); // store for auth headers
      navigate(data.redirect_path);
    } else if (res.status === 401) {
      toast.error('Invalid username or password');
    } else if (res.status === 403) {
      toast.error('Account is not activated');
    } else if (res.status === 500) {
      toast.error('Internal server error');
    } else {
      toast.error('Unknown error');
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
                      <div className="or"></div>
                      <form>
                        <p className="font-p">Enter Server access token</p>
                        <input
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
    <div className="max-w-2xl mx-auto mt-10">
      <Swiper
        modules={[Autoplay]}
        spaceBetween={20}
        slidesPerView={1}
        loop
        autoplay={{ delay: 2500, disableOnInteraction: false }}
      >
        {texts.map((text, index) => (
          <SwiperSlide key={index}>
            <div className="text-center text-xl text-gray-800 font-semibold py-6">{text}</div>
          </SwiperSlide>
        ))}
      </Swiper>
    </div>
  );
};

export default Login;
