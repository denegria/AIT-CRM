import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getWorkOSAuthorizationUrl, usesWorkOSAuth } from '@/lib/auth';
import {
  OAUTH_INVITATION_COOKIE,
  OAUTH_RETURN_TO_COOKIE,
  OAUTH_STATE_COOKIE,
  safeOAuthReturnTo,
} from '@/lib/auth/oauth-state.js';

const OAUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: 10 * 60,
};

function requestOrigin(request) {
  const proto = request.headers.get('x-forwarded-proto');
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  return proto && host ? `${proto}://${host}` : request.nextUrl.origin;
}

export async function GET(request) {
  if (!usesWorkOSAuth()) return NextResponse.redirect(new URL('/', request.nextUrl.origin));

  const invitationToken = request.nextUrl.searchParams.get('invitation_token') || '';
  const loginHint = request.nextUrl.searchParams.get('login_hint') || '';
  const returnTo = safeOAuthReturnTo(request.nextUrl.searchParams.get('return_to'));
  const state = randomBytes(32).toString('base64url');
  const redirectUri = `${requestOrigin(request)}/api/auth/callback`;
  const authorizationUrl = getWorkOSAuthorizationUrl({
    redirectUri,
    state,
    invitationToken,
    loginHint,
    screenHint: invitationToken ? 'sign-up' : 'sign-in',
  });

  const response = NextResponse.redirect(authorizationUrl);
  response.cookies.set(OAUTH_STATE_COOKIE, state, OAUTH_COOKIE_OPTIONS);
  response.cookies.set(OAUTH_RETURN_TO_COOKIE, returnTo, OAUTH_COOKIE_OPTIONS);
  if (invitationToken) {
    response.cookies.set(OAUTH_INVITATION_COOKIE, invitationToken, OAUTH_COOKIE_OPTIONS);
  }
  return response;
}
