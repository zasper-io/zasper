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
    <HashRouter>
      <Routes>
        {routes.map((route, i) => {
          return <Route key={i} path={route.path} element={<route.component />} />;
        })}
      </Routes>
    </HashRouter>
  );
}
