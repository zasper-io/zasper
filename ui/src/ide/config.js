const port = process.env.NODE_ENV === 'development' ? 8048 : '';

export const BaseApiUrl = process.env.NODE_ENV === 'development' ? `http://localhost:${port}` : '';

export const BaseWebSocketUrl =
  process.env.NODE_ENV === 'development'
    ? `ws://localhost:${port}`
    : window.location.protocol === 'https:'
      ? `wss://${window.location.host}`
      : `ws://${window.location.host}`;

export const WsBaseUrl =
  process.env.NODE_ENV === 'development'
    ? `ws://localhost:${port}/api/kernels/`
    : window.location.protocol === 'https:'
      ? `wss://${window.location.host}/api/kernels/`
      : `ws://${window.location.host}/api/kernels/`;
