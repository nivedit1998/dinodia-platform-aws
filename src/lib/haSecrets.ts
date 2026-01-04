import crypto from 'crypto';
import { decryptAtRest, encryptAtRest } from './cryptoAtRest';

type HasHaSecrets = {
  haUsername?: string | null;
  haUsernameCiphertext?: string | null;
  haPassword?: string | null;
  haPasswordCiphertext?: string | null;
  longLivedToken?: string | null;
  longLivedTokenCiphertext?: string | null;
};

export function resolveHaSecrets(record: HasHaSecrets): {
  haUsername: string;
  haPassword: string;
  longLivedToken: string;
} {
  const haUsername =
    (record.haUsernameCiphertext
      ? decryptAtRest(record.haUsernameCiphertext)
      : record.haUsername) ?? null;
  const haPassword =
    (record.haPasswordCiphertext
      ? decryptAtRest(record.haPasswordCiphertext)
      : record.haPassword) ?? null;
  const longLivedToken =
    (record.longLivedTokenCiphertext
      ? decryptAtRest(record.longLivedTokenCiphertext)
      : record.longLivedToken) ?? null;

  if (!haUsername || !haPassword || !longLivedToken) {
    throw new Error('Home Assistant credentials are missing or incomplete.');
  }

  return { haUsername, haPassword, longLivedToken };
}

export function buildEncryptedHaSecrets(input: {
  haUsername?: string;
  haPassword?: string;
  longLivedToken?: string;
}) {
  const data: {
    haUsername?: string | null;
    haUsernameCiphertext?: string | null;
    haPassword?: string | null;
    haPasswordCiphertext?: string | null;
    longLivedToken?: string | null;
    longLivedTokenCiphertext?: string | null;
  } = {};

  if (input.haUsername !== undefined) {
    data.haUsername = null;
    data.haUsernameCiphertext = input.haUsername ? encryptAtRest(input.haUsername) : null;
  }
  if (input.haPassword !== undefined) {
    data.haPassword = null;
    data.haPasswordCiphertext = input.haPassword ? encryptAtRest(input.haPassword) : null;
  }
  if (input.longLivedToken !== undefined) {
    data.longLivedToken = null;
    data.longLivedTokenCiphertext = input.longLivedToken
      ? encryptAtRest(input.longLivedToken)
      : null;
  }

  return data;
}

export function hashSecretForLookup(secret: string): string {
  return crypto.createHash('sha256').update(secret, 'utf8').digest('hex');
}
