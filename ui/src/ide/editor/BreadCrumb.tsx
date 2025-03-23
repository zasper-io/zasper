import React from 'react';
import './Editor.scss';

export default function BreadCrumb(props) {
  return (
    <div className="breadcrumbArea">
      <nav aria-label="breadcrumb">
        <ol className="breadcrumb">
          {props.path.split('/').map((item, index) => {
            if (item === '') {
              return (
                <li key={index} className="breadcrumb-item">
                  root
                </li>
              );
            }
            return (
              <li key={index} className="breadcrumb-item">
                {item}
              </li>
            );
          })}
        </ol>
      </nav>
    </div>
  );
}
