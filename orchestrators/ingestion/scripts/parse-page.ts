import { parseFacrMatchPage } from '../src/Facr.ts';
import * as Effect from 'effect/Effect';
import { readFileSync } from 'node:fs';
const r = Effect.runSyncExit(parseFacrMatchPage(readFileSync(process.argv[2]!, 'utf8')));
if (r._tag === 'Failure') {
  console.error(JSON.stringify(r.cause, null, 1));
  process.exit(1);
}
console.log(JSON.stringify(r.value, null, 1));
