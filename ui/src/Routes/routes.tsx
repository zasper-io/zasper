import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import IDE from '../ide/IDE';
import Login from '../auth/Login';
import { JSX, useEffect, useState } from 'react';
import { getConfig, logApiError } from '../api';

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
  return isAuthenticated() ? element : <Navigate to="/login" replace />;
}

export default function RouteConfig() {
  const [protectedState, setProtectedState] = useState(false);

  useEffect(() => {
    getConfig()
      .then((config) => {
        setProtectedState(config.protected);
      })
      .catch(logApiError('Error fetching config:'));
  }, [setProtectedState]);

  if (protectedState) {
    return (
      <BrowserRouter>
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
      <BrowserRouter>
        <Routes>
          {routes.map((route, i) => (
            <Route key={i} path={route.path} element={<route.component />} />
          ))}
        </Routes>
      </BrowserRouter>
    );
  }
}
