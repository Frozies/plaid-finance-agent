import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from '../services/crypto';

describe('crypto service', () => {
  it('encrypts and decrypts a string roundtrip', () => {
    const plaintext = 'access-sandbox-abc123-def456';
    const { encrypted, iv, authTag } = encrypt(plaintext);

    expect(encrypted).toBeTruthy();
    expect(iv).toBeTruthy();
    expect(authTag).toBeTruthy();
    expect(encrypted).not.toBe(plaintext);

    const decrypted = decrypt(encrypted, iv, authTag);
    expect(decrypted).toBe(plaintext);
  });

  it('produces different ciphertext for the same plaintext (random IV)', () => {
    const plaintext = 'test-token';
    const result1 = encrypt(plaintext);
    const result2 = encrypt(plaintext);

    expect(result1.iv).not.toBe(result2.iv);
    expect(result1.encrypted).not.toBe(result2.encrypted);

    // Both should still decrypt to the same value
    expect(decrypt(result1.encrypted, result1.iv, result1.authTag)).toBe(plaintext);
    expect(decrypt(result2.encrypted, result2.iv, result2.authTag)).toBe(plaintext);
  });

  it('fails to decrypt with wrong IV', () => {
    const { encrypted, authTag } = encrypt('secret');
    const wrongIv = '00'.repeat(16);

    expect(() => decrypt(encrypted, wrongIv, authTag)).toThrow();
  });

  it('fails to decrypt with wrong auth tag', () => {
    const { encrypted, iv } = encrypt('secret');
    const wrongTag = '00'.repeat(16);

    expect(() => decrypt(encrypted, iv, wrongTag)).toThrow();
  });

  it('handles empty string', () => {
    const { encrypted, iv, authTag } = encrypt('');
    expect(decrypt(encrypted, iv, authTag)).toBe('');
  });

  it('handles unicode content', () => {
    const plaintext = '日本語テスト 🎉';
    const { encrypted, iv, authTag } = encrypt(plaintext);
    expect(decrypt(encrypted, iv, authTag)).toBe(plaintext);
  });
});
