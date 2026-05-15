export interface User {
  id: string;
  email: string;
  name: string;
  pictureUrl?: string;
}

export interface LoginResponse {
  token: string;
  expiresAt: string;
  user: User;
}

export interface GoogleLoginRequest {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}
