const port = process.env.NODE_ENV === 'development' ? 8048 : '';

// Base API URL for development and production
export const BaseApiUrl = process.env.NODE_ENV === 'development'
  ? `http://localhost:${port}`
  : '';

// Base WebSocket URL for development and production
export const BaseWebSocketUrl = process.env.NODE_ENV === 'development'
  ? `ws://localhost:${port}`
  : '';

// WebSocket Base URL
export const WsBaseUrl = process.env.NODE_ENV  === 'development'
  ? `ws://localhost:${port}/api/kernels/`
  : '/api/kernels/';

