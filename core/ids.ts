import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Short, URL-safe, collision-resistant id (no external deps). */
export function id(size = 12): string {
  const bytes = randomBytes(size);
  let out = "";
  for (let i = 0; i < size; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}
