import {
  HashRouter,
  Route,
  Routes,
} from "react-router-dom";
import React from 'react';
import Lab from "../ide/IDE";

const routes = [
  {
    path: "/",
    component: Lab,
    protected: false
  },
];

export default function RouteConfigExample() {
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
