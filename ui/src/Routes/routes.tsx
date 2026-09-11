import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { JSX, lazy, Suspense, useEffect, useState } from 'react';

import { getConfig, login, logApiError } from '@/api';

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

/** The access token in the link the server opens, `/?token=…`. A pure read, so safe as an initializer. */
function linkToken(): string | null {
  return new URLSearchParams(window.location.search).get('token');
}

/** Takes the token back out of the address bar, so it is left in neither history nor a bookmark. */
function forgetLinkToken() {
  const url = new URL(window.location.href);
  url.searchParams.delete('token');
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
}

export default function RouteConfig() {
  const [protectedState, setProtectedState] = useState(false);
  const [pendingToken] = useState(linkToken);
  const [signingIn, setSigningIn] = useState(pendingToken !== null);

  useEffect(() => {
    getConfig()
      .then((config) => {
        setProtectedState(config.protected);
      })
      .catch(logApiError('Error fetching config:'));
  }, [setProtectedState]);

  // Before anything routes: the IDE would otherwise boot with no session, get a 401 and bounce to
  // /login. A refused token keeps whatever session was already held; a stale link is not a sign-out.
  useEffect(() => {
    if (pendingToken === null) {
      return;
    }
    forgetLinkToken();
    login(pendingToken)
      .then((data) => localStorage.setItem('token', data.token))
      .catch(logApiError('The access token in the link was not accepted:'))
      .finally(() => setSigningIn(false));
  }, [pendingToken]);

  if (signingIn) {
    return null;
  }

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
