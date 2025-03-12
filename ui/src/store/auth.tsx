import { atom } from 'jotai';

interface state {
  authorizationToken: string;
  authorizationTokenExpiry: string;
  idToken: string;
  idTokenExpiry: string;
  refreshToken: string;
  refreshTokenExpiry: string;
  user: string;
}
