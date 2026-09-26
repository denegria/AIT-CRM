const PBKDF2_SHA512_MIN_ITERATIONS = 210000;
const PBKDF2_SHA512_MAX_ITERATIONS = 1000000;
const CRM_PASSWORD_HASH_BYTES = 64;

function unpaddedBase64(buffer) {
  return buffer.toString('base64').replace(/=+$/u, '');
}

function decodeBase64(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('workos_password_hash_invalid');
  }

  const normalized = value.trim();
  const decoded = Buffer.from(normalized, 'base64');
  if (!decoded.length || decoded.toString('base64').replace(/=+$/u, '') !== normalized.replace(/=+$/u, '')) {
    throw new Error('workos_password_hash_invalid');
  }
  return decoded;
}

export function credentialToWorkOSPbkdf2Hash(credential) {
  const digest = String(credential?.passwordDigest || 'sha512').trim().toLowerCase();
  const iterations = Number(credential?.passwordIterations);
  const salt = credential?.passwordSalt;

  if (digest !== 'sha512') throw new Error('workos_password_digest_unsupported');
  if (!Number.isInteger(iterations)
    || iterations < PBKDF2_SHA512_MIN_ITERATIONS
    || iterations > PBKDF2_SHA512_MAX_ITERATIONS) {
    throw new Error('workos_password_iterations_unsupported');
  }
  if (typeof salt !== 'string' || !salt.length) {
    throw new Error('workos_password_salt_invalid');
  }

  const hash = decodeBase64(credential?.passwordHash);
  if (hash.length !== CRM_PASSWORD_HASH_BYTES) {
    throw new Error('workos_password_hash_invalid');
  }

  // CRM's PBKDF2 implementation passes its hexadecimal-looking salt as UTF-8
  // text. Encoding the displayed hex as bytes would silently change the hash.
  const encodedSalt = unpaddedBase64(Buffer.from(salt, 'utf8'));
  const encodedHash = unpaddedBase64(hash);
  return `$pbkdf2$i=${iterations},d=sha512$${encodedSalt}$${encodedHash}`;
}

export const WORKOS_PBKDF2_PASSWORD_HASH_TYPE = 'pbkdf2';
