/** Shown in place of a cell's execution count while the kernel is running it. */
const LoaderSvg = () => {
  return (
    <div className="svgContainer">
      <svg
        className="spinner"
        xmlns="http://www.w3.org/2000/svg"
        width="50px"
        height="50px"
        viewBox="0 0 100 100"
      >
        <path d="M 50,50 L 33,60.5 a 20 20 -210 1 1 34,0 z" fill="blue">
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="0 50 50"
            to="360 50 50"
            dur="1.2s"
            repeatCount="indefinite"
          />
        </path>
        <circle cx="50" cy="50" r="16" fill="#fff"></circle>
      </svg>
    </div>
  );
};

export default LoaderSvg;
