export default function ErrorDialog(props) {
  return (
    <div className="modal" id="exampleModal" aria-labelledby="exampleModalLabel">
      <div className="modal-dialog modal-dialog-centered">
        <div className="modal-content">
          <div className="modal-head error-head">
            Error
            <button
              type="button"
              className="modal-btn-close"
              aria-label="Close"
              onClick={props.toggleErrorDialog}
            >
              {' '}
              <i className="fas fa-times-circle"></i>{' '}
            </button>
          </div>
          <div className="modal-body">
            <div className="update-kernel-popup">
              <p>
                Error encountered launching the kernel. <br /> Please switch kernel.
              </p>
            </div>
            <div className="update-kernel-popup">
              <div className="update-kernel-popup-form">
                <button className="gitbutton" onClick={props.toggleErrorDialog}>
                  Switch
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
