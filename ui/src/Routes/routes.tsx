import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import IDE from '../ide/IDE';
import Login from '../auth/Login';
import { JSX, useEffect, useState } from 'react';
import { BaseApiUrl } from '../ide/config';

const isAuthenticated = () => {
  // For example, check for token in localStorage or context
  return localStorage.getItem('token') !== null;
};

const routes = [
  {
    path: '/',
    component: IDE,
    protected: true,
  },
  {
    path: '/login',
    component: Login,
    protected: false,
  },
];

// Wrapper for protected routes
function ProtectedRoute({ element }: { element: JSX.Element }) {
  console.log(isAuthenticated());
  return isAuthenticated() ? element : <Navigate to="/login" replace />;
}

export default function RouteConfig() {
  const [protectedState, setProtectedState] = useState(false);

  useEffect(() => {
    fetch(BaseApiUrl + '/api/info', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    })
      .then((res) => res.json())
      .then((data) => {
        console.log('Contents:', data);
        setProtectedState(data.protected);
      })
      .catch((error) => {
        console.error('Error fetching contents:', error);
      });
  }, [setProtectedState]);

  if (protectedState) {
    return (
      <BrowserRouter
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <Routes>
          {routes.map((route, i) => (
            <Route
              key={i}
              path={route.path}
              element={
                route.protected ? (
                  <ProtectedRoute element={<route.component />} />
                ) : (
                  <route.component />
                )
              }
            />
          ))}
        </Routes>
      </BrowserRouter>
    );
  } else {
    return (
      <BrowserRouter
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <Routes>
          {routes.map((route, i) => (
            <Route key={i} path={route.path} element={<route.component />} />
          ))}
        </Routes>
      </BrowserRouter>
    );
  }
}
