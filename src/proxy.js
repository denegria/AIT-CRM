import { NextResponse } from 'next/server';

export function proxy(request) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-ait-crm-pathname', request.nextUrl.pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
