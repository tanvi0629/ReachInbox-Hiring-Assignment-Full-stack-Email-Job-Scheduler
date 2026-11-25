import { User } from '@/types';

export function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('auth_token');
}

export function setStoredToken(token: string): void {
  localStorage.setItem('auth_token', token);
}

export function removeStoredToken(): void {
  localStorage.removeItem('auth_token');
}

export function decodeToken(token: string): User | null {
  try {
    const base64 = token.split('.')[1];
    const decoded = JSON.parse(atob(base64));
    // Check token expiry
    if (decoded.exp && decoded.exp * 1000 < Date.now()) return null;
    return {
      userId: decoded.userId,
      email: decoded.email,
      name: decoded.name,
      avatar: decoded.avatar,
    };
  } catch {
    return null;
  }
}
