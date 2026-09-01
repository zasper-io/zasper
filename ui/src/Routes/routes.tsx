import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { JSX, lazy, Suspense, useEffect, useState } from 'react';

import { getConfig, logApiError } from '@/api';

// Both route components load on demand, so the two screens don't pay for each
// other: /login would otherwise pull in the whole IDE (CodeMirror and all), and /
// would pull in the login carousel.
const IDE = lazy(() => import('@/ide/IDE'));
const Login = lazy(() => import('@/auth/Login'));

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

  return (
    <BrowserRouter>
      {/* No fallback markup: the route chunk is the first thing rendered, so
          anything here would only flash. */}
      <Suspense fallback={null}>
        <Routes>
          {routes.map((route, i) => (
            <Route
              key={i}
              path={route.path}
              element={
                // `protected` marks which routes *can* be gated; whether gating
                // is on at all comes from the server's /api/config.
                route.protected && protectedState ? (
                  <ProtectedRoute element={<route.component />} />
                ) : (
                  <route.component />
                )
              }
            />
          ))}
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
