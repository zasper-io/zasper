const isDev = import.meta.env.DEV;

// In development the Go backend runs separately on 8048; in production it serves
// the bundled frontend itself, so same-origin relative URLs are enough.
const devHost = 'localhost:8048';

const wsScheme = window.location.protocol === 'https:' ? 'wss' : 'ws';

export const BaseApiUrl = isDev ? `http://${devHost}` : '';

export const BaseWebSocketUrl = isDev ? `ws://${devHost}` : `${wsScheme}://${window.location.host}`;

export const WsBaseUrl = `${BaseWebSocketUrl}/api/kernels/`;
