// Where the backend lives. This is build-environment configuration, not IDE
// configuration, which is why it sits at the top of src/ rather than under ide/:
// api/client.ts needs it, and api/ must not depend on the component tree.
//
// Not to be confused with api/config.ts, which is the client for the /api/config
// endpoint.

const isDev = import.meta.env.DEV;

// In development the Go backend runs separately on 8048; in production it serves
// the bundled frontend itself, so same-origin relative URLs are enough.
const devHost = 'localhost:8048';

const wsScheme = window.location.protocol === 'https:' ? 'wss' : 'ws';

export const BaseApiUrl = isDev ? `http://${devHost}` : '';

export const BaseWebSocketUrl = isDev ? `ws://${devHost}` : `${wsScheme}://${window.location.host}`;

export const WsBaseUrl = `${BaseWebSocketUrl}/api/kernels/`;
