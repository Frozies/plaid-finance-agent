import crypto from 'crypto';
import config from '../config';
import type { EncryptedData } from '../types';

const ALGORITHM = 'aes-256-gcm' as const;
const IV_LENGTH = 16;

export function encrypt(plaintext: string): EncryptedData {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, config.encryption.key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return {
    encrypted,
    iv: iv.toString('hex'),
    authTag,
  };
}

export function decrypt(encrypted: string, ivHex: string, authTagHex: string): string {
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    config.encryption.key,
    Buffer.from(ivHex, 'hex')
  );
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
