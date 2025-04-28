import crypto from 'node:crypto';

/**
 * Simple SHA-256 helper used for deterministically generating IDs.
 * The output is a hex string (lowercase, 64 chars).
 */
export function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}
