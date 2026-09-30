/**
 * The bff's login password pipeline, inverted. The server's `decryptPD`
 * (`internal/bff-service/service/permission_user.go`) does
 * URL-unescape → base64 (std, padded) → AES-CBC decrypt with the
 * `decrypt-passwd` key/iv taken as raw bytes, PKCS#7-style padding — so the
 * client sends `encodeURIComponent(base64(aesCbc(plain)))`.
 */
import { createCipheriv } from 'node:crypto'

/** AES cipher name for one key's byte length (16/24/32 → 128/192/256). */
function algorithmOf(keyBytes: number): string {
  if (keyBytes === 16) return 'aes-128-cbc'
  if (keyBytes === 24) return 'aes-192-cbc'
  if (keyBytes === 32) return 'aes-256-cbc'
  throw new Error(`nexusai: decrypt-passwd key must be 16, 24, or 32 bytes, got ${keyBytes}`)
}

/** Encrypt a login password exactly as the web frontend does. */
export function encryptPassword(plain: string, key: string, iv: string): string {
  const keyBytes = Buffer.from(key, 'utf8')
  const ivBytes = Buffer.from(iv, 'utf8')
  const cipher = createCipheriv(algorithmOf(keyBytes.length), keyBytes, ivBytes)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return encodeURIComponent(encrypted.toString('base64'))
}
