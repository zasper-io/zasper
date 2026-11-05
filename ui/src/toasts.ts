import { toast } from 'react-toastify';

/*
Every toast is `role="alert"` unless it says otherwise, and an alert interrupts whatever a screen reader
is in the middle of. That is right for a failure and wrong for "Copied", so a success or a note is a
polite `status` here, once, rather than at each of the places that raise one. An error and a warning
stay alerts.
*/
const success = toast.success;
const info = toast.info;
toast.success = ((content, options) =>
  success(content, { role: 'status', ...options })) as typeof toast.success;
toast.info = ((content, options) =>
  info(content, { role: 'status', ...options })) as typeof toast.info;
