import * as Data from 'effect/Data';

// The page carries none of the structure a match page of its source has.
// Asking again cannot help, so this is kept apart from a page that has the
// structure but not the content.
export class NotAMatchPageError extends Data.TaggedError('NotAMatchPageError')<{
  readonly message: string;
}> {}

// The page has the structure of a match page, but something in it is not
// where or what the reader expects. Every such thing is a finding, so a page
// that fails says how, and the reader can be taught.
export class MatchReportParseError extends Data.TaggedError('MatchReportParseError')<{
  readonly message: string;
  readonly findings: ReadonlyArray<string>;
}> {}
