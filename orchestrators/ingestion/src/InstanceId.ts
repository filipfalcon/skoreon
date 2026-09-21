import type { Source } from '#Enums';
import * as Effect from 'effect/Effect';

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

// One page, one instance. The id is the source and a digest of the HTML, so
// submitting the same page again finds the instance it already has instead of
// starting another. A re-scrape whose markup changed is a different page, and
// telling those apart by match number is the writer's job.
export const instanceId = (source: Source, html: string): Effect.Effect<string> =>
  Effect.promise(() => crypto.subtle.digest('SHA-256', new TextEncoder().encode(html))).pipe(
    Effect.map((digest) => `${source.toLowerCase()}-${hex(new Uint8Array(digest))}`),
  );
