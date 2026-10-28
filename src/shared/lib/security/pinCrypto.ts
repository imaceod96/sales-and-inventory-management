import { ValidationError } from '../../types/errors';

export function validatePinFormat(pin: string): string {
  const sanitized = (pin || '').trim();
  if (!/^\d{6}$/.test(sanitized)) {
    throw new ValidationError('El PIN debe constar exactamente de 6 dígitos numéricos.');
  }
  return sanitized;
}

function getCryptoSubtle(): SubtleCrypto {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) {
    return globalThis.crypto.subtle;
  }
  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    return window.crypto.subtle;
  }
  throw new Error('Web Crypto API no se encuentra disponible en este entorno.');
}

function getCryptoRandomValues(buffer: Uint8Array): Uint8Array {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(buffer as any);
    return buffer;
  }
  if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(buffer as any);
    return buffer;
  }
  for (let i = 0; i < buffer.length; i++) {
    buffer[i] = Math.floor(Math.random() * 256);
  }
  return buffer;
}

export async function hashPinPBKDF2(
  pin: string,
  existingSaltHex?: string,
  iterations = 100000
): Promise<{ hashHex: string; saltHex: string; iterations: number }> {
  const cleanPin = validatePinFormat(pin);
  const subtle = getCryptoSubtle();
  const encoder = new TextEncoder();

  let salt: Uint8Array;
  if (existingSaltHex) {
    const bytes: number[] = [];
    for (let i = 0; i < existingSaltHex.length; i += 2) {
      bytes.push(parseInt(existingSaltHex.slice(i, i + 2), 16));
    }
    salt = new Uint8Array(bytes);
  } else {
    salt = new Uint8Array(16);
    getCryptoRandomValues(salt);
  }

  const keyMaterial = await subtle.importKey(
    'raw',
    encoder.encode(cleanPin),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );

  const derivedBits = await subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as any,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );

  const derivedArray = new Uint8Array(derivedBits);
  const hashHex = Array.from(derivedArray)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const saltHexStr = Array.from(salt)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return {
    hashHex,
    saltHex: saltHexStr,
    iterations,
  };
}

export async function verifyPinPBKDF2(
  inputPin: string,
  storedHashHex: string,
  storedSaltHex: string,
  iterations = 100000
): Promise<boolean> {
  try {
    const { hashHex } = await hashPinPBKDF2(inputPin, storedSaltHex, iterations);
    if (hashHex.length !== storedHashHex.length) return false;
    let result = 0;
    for (let i = 0; i < hashHex.length; i++) {
      result |= hashHex.charCodeAt(i) ^ storedHashHex.charCodeAt(i);
    }
    return result === 0;
  } catch {
    return false;
  }
}
