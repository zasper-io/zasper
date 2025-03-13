import React from 'react';
import { Link } from 'react-router-dom';
import 'react-toastify/dist/ReactToastify.css';

import './Home.scss';

function Home() {
  return (
    <div className="dashboard-content content-full" id="content">
      <div className="dashboard-content-wraper">
        <div className="container-fluid">
          <div className="row">
            <div className="col-12">
              <div className="dashboard-title">
                <h2 className="font-h2 fontw-300">
                  Welcome to <span className="fontw-500">zasper</span>
                </h2>
              </div>
            </div>
          </div>
        </div>

        <div className="container-fluid">
          <div className="row">
            <div className="col-12">
              <div className="dashboard-content-features-wraper">
                <div className="dashboard-content-features">
                  <div className="dashboard-content-features-icon">
                    <img src="./images/help.svg" alt="#" />
                  </div>
                  <div className="dashboard-content-features-info">
                    <h5>Explore the Quickstart Tutorial</h5>
                    <p>
                      Spin up a cluster, run queries on preloaded data, and display results in 5
                      minutes.
                    </p>
                    <a
                      href="https://docs.zasper.io/documentation.html"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-bg"
                    >
                      Explore More
                    </a>
                  </div>
                </div>
                <div className="dashboard-content-features">
                  <div className="dashboard-content-features-icon">
                    <img src="./images/upload.svg" alt="#" />
                  </div>
                  <div className="dashboard-content-features-info">
                    <h5>Import and Export Data</h5>
                    <p>
                      Quickly import data, preview its schema, create a table, and query it in a
                      notebook.
                    </p>
                    <a
                      href="https://docs.zasper.io/documentation.html"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-bg"
                    >
                      Explore More
                    </a>
                  </div>
                </div>
                <div className="dashboard-content-features">
                  <div className="dashboard-content-features-icon">
                    <img src="./images/file2.svg" alt="#" />
                  </div>
                  <div className="dashboard-content-features-info">
                    <h5>Create a New Project</h5>
                    <p>Create a notebook to start querying, visualizing, and modeling your data.</p>
                    <a href="/workspace" className="btn-bg">
                      Explore More
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="container-fluid">
          <div className="row">
            <div className="col-12">
              <div className="dashboard-task-wraper">
                <div className="dashboard-task-items">
                  <h6>COMMON TASKS</h6>
                  <Link to="/workspace/">
                    <span>New Notebook</span>
                  </Link>
                  <Link to="https://docs.zasper.io" target="_blank" rel="noopener noreferrer">
                    <span>Read Documentation</span>
                  </Link>
                </div>

                <div className="dashboard-task-items">
                  <h6>RECENTS</h6>
                  <Link to="#">
                    <span>Quickstart Notebook (1)</span>
                  </Link>
                  <Link to="#">
                    <span>Quickstart Notebook</span>
                  </Link>
                  <div>
                    <button className="btn-bg">Notify!</button>
                  </div>
                </div>

                <div className="dashboard-task-items">
                  <h6>RECENTS</h6>
                  <Link to="https://docs.zasper.io" target="_blank" rel="noopener noreferrer">
                    <span>Zasper Status</span>
                  </Link>
                  <Link to="https://docs.zasper.io" target="_blank" rel="noopener noreferrer">
                    <span>View latest release notes</span>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Home;
