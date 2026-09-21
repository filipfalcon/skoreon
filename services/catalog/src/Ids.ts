import * as Clock from 'effect/Clock';
import * as Effect from 'effect/Effect';

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

// A UUID version 7: 48 bits of Unix time in milliseconds, then random bits,
// so ids sort by creation and the seed data's `019f...-7000-...` shape holds.
export const uuidV7: Effect.Effect<string> = Effect.gen(function* () {
  const now = yield* Clock.currentTimeMillis;
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  for (let i = 5; i >= 0; i--) {
    bytes[i] = Math.floor(now / 256 ** (5 - i)) % 256;
  }
  bytes[6] = 0x70 | (bytes[6]! & 0x0f);
  bytes[8] = 0x80 | (bytes[8]! & 0x3f);
  const s = hex(bytes);
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
});
