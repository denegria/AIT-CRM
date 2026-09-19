import { NextResponse } from 'next/server';
import { sendWorkOSPasswordReset, usesWorkOSAuth } from '@/lib/auth';

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (usesWorkOSAuth() && email && email.length <= 320) {
    await sendWorkOSPasswordReset(email).catch(() => {});
  }
  // Always return the same response to prevent account enumeration.
  return NextResponse.json({ accepted: true }, { status: 202 });
}
