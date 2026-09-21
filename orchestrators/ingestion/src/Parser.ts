import type { Source } from '#Enums';
import type { MatchReportParseError, NotAMatchPageError } from '#Errors';
import { parseFacrMatchPage } from '#Facr';
import type { MatchReport } from '#MatchReport';
import type * as Effect from 'effect/Effect';

// Turns the HTML of a scraped match page into a match report. Each source has
// its own reader, written to that source's markup; the report is the same for
// all of them.
const readers: Record<
  Source,
  (html: string) => Effect.Effect<MatchReport, NotAMatchPageError | MatchReportParseError>
> = {
  FACR: parseFacrMatchPage,
};

export const parseMatchPage = (
  source: Source,
  html: string,
): Effect.Effect<MatchReport, NotAMatchPageError | MatchReportParseError> => readers[source](html);
