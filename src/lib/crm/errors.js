import { NextResponse } from 'next/server.js';

export function createCrmError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function crmErrorResponse(error) {
  if (!error?.status) throw error;
  return NextResponse.json({
    error: error.message,
    ...(error.code ? { code: error.code } : {}),
  }, { status: error.status });
}
