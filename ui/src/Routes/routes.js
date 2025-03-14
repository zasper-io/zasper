import { HashRouter, Route, Routes } from 'react-router-dom';
import IDE from '../ide/IDE';

const routes = [
  {
    path: '/',
    component: IDE,
    protected: false,
  },
];

export default function RouteConfig() {
  return (
    <HashRouter
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      <Routes
        future={{
          v7_relativeSplatPath: true,
        }}
      >
        {routes.map((route, i) => {
          return <Route key={i} path={route.path} element={<route.component />} />;
        })}
      </Routes>
    </HashRouter>
  );
}
