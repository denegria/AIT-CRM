import { NextResponse } from 'next/server';
import {
  authenticateWorkOSCode,
  authenticateWorkOSInvitationCode,
  setWorkOSAuthCookie,
  usesWorkOSAuth,
} from '@/lib/auth';
import {
  equalOAuthState,
  OAUTH_INVITATION_COOKIE,
  OAUTH_RETURN_TO_COOKIE,
  OAUTH_STATE_COOKIE,
  safeOAuthReturnTo,
} from '@/lib/auth/oauth-state.js';

function clearOAuthCookies(response) {
  const options = {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  };
  response.cookies.set(OAUTH_STATE_COOKIE, '', options);
  response.cookies.set(OAUTH_INVITATION_COOKIE, '', options);
  response.cookies.set(OAUTH_RETURN_TO_COOKIE, '', options);
}

function failureResponse(request, reason = 'signin_failed') {
  const target = new URL('/join', request.nextUrl.origin);
  target.searchParams.set('error', reason);
  const response = NextResponse.redirect(target);
  clearOAuthCookies(response);
  return response;
}

export async function GET(request) {
  if (!usesWorkOSAuth()) return failureResponse(request, 'signin_unavailable');

  const code = request.nextUrl.searchParams.get('code') || '';
  const state = request.nextUrl.searchParams.get('state') || '';
  const expectedState = request.cookies.get(OAUTH_STATE_COOKIE)?.value || '';
  const invitationToken = request.cookies.get(OAUTH_INVITATION_COOKIE)?.value || '';
  const returnTo = request.cookies.get(OAUTH_RETURN_TO_COOKIE)?.value || '/';
  if (!code || !equalOAuthState(state, expectedState)) return failureResponse(request, 'signin_expired');

  try {
    const options = {
      code,
      ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined,
      userAgent: request.headers.get('user-agent') || undefined,
    };
    const result = invitationToken
      ? await authenticateWorkOSInvitationCode({ ...options, invitationToken })
      : await authenticateWorkOSCode(options);
    const response = NextResponse.redirect(new URL(safeOAuthReturnTo(returnTo), request.nextUrl.origin));
    setWorkOSAuthCookie(response, result.sessionData);
    clearOAuthCookies(response);
    return response;
  } catch (error) {
    const reason = error?.status === 403 || error?.status === 409 ? 'access_denied' : 'signin_failed';
    return failureResponse(request, reason);
  }
}
