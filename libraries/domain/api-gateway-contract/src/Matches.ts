import { FifaCountry, PlayerPosition, Sex, Side, Source } from '#Enums';
import * as Schema from 'effect/Schema';
import * as HttpApiEndpoint from 'effect/unstable/httpapi/HttpApiEndpoint';
import * as HttpApiGroup from 'effect/unstable/httpapi/HttpApiGroup';
import * as HttpApiSchema from 'effect/unstable/httpapi/HttpApiSchema';

export const UnmatchedKind = Schema.Literals([
  'COMPETITION',
  'ROUND',
  'TEAM',
  'PLAYER',
  'OFFICIAL',
]);
export type UnmatchedKind = typeof UnmatchedKind.Type;

// A catalog row a reviewer may pick for a name the matcher could not settle.
// For a player, `registered` says whether the row already holds a registration
// with the team in this edition; picking an unregistered one registers it and
// nothing more.
export const Candidate = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  registered: Schema.optionalKey(Schema.Boolean),
});
export type Candidate = typeof Candidate.Type;

// What creating the record would take, as the page leaves it: what the page
// states is filled in, what it does not is null and the reviewer's to supply.
export const TeamCreation = Schema.Struct({
  name: Schema.String,
  establishedOn: Schema.NullOr(Schema.String),
});
export const PlayerCreation = Schema.Struct({
  givenName: Schema.String,
  familyName: Schema.String,
  sex: Sex,
  dateOfBirth: Schema.NullOr(Schema.String),
  nationality: Schema.NullOr(FifaCountry),
  primaryPosition: Schema.NullOr(PlayerPosition),
});
export const OfficialCreation = Schema.Struct({
  givenName: Schema.String,
  familyName: Schema.String,
  sex: Schema.NullOr(Sex),
  dateOfBirth: Schema.NullOr(Schema.String),
  nationality: Schema.NullOr(FifaCountry),
});
export const Creation = Schema.Union([TeamCreation, PlayerCreation, OfficialCreation]);
export type Creation = typeof Creation.Type;

// The record complete, as a create decision must carry it. Nothing is filled
// in for the reviewer: a decision missing a field is not a decision.
export const TeamCreate = Schema.Struct({
  name: Schema.NonEmptyString,
  establishedOn: Schema.NonEmptyString,
});
export type TeamCreate = typeof TeamCreate.Type;
export const PlayerCreate = Schema.Struct({
  givenName: Schema.NonEmptyString,
  familyName: Schema.NonEmptyString,
  sex: Sex,
  dateOfBirth: Schema.NonEmptyString,
  nationality: FifaCountry,
  primaryPosition: PlayerPosition,
});
export type PlayerCreate = typeof PlayerCreate.Type;
export const OfficialCreate = Schema.Struct({
  givenName: Schema.NonEmptyString,
  familyName: Schema.NonEmptyString,
  sex: Sex,
  dateOfBirth: Schema.NonEmptyString,
  nationality: FifaCountry,
});
export type OfficialCreate = typeof OfficialCreate.Type;

// A name from the page that matched no catalog row, or more than one, with
// every row it may legitimately be and, where the kind allows it, what
// creating a new row would take.
export const Unmatched = Schema.Struct({
  kind: UnmatchedKind,
  side: Schema.NullOr(Side),
  printed: Schema.String,
  candidates: Schema.Array(Candidate),
  creation: Schema.NullOr(Creation),
});
export type Unmatched = typeof Unmatched.Type;

// A reviewer's answer to one unmatched name: which candidate it is, or the
// record to create for it. The kind decides which record.
const decision = { side: Schema.NullOr(Side), printed: Schema.String };

export const PickDecision = Schema.Struct({
  kind: UnmatchedKind,
  ...decision,
  candidateId: Schema.String,
});
export type PickDecision = typeof PickDecision.Type;
export const CreateTeamDecision = Schema.Struct({
  kind: Schema.Literal('TEAM'),
  ...decision,
  create: TeamCreate,
});
export const CreatePlayerDecision = Schema.Struct({
  kind: Schema.Literal('PLAYER'),
  ...decision,
  create: PlayerCreate,
});
export const CreateOfficialDecision = Schema.Struct({
  kind: Schema.Literal('OFFICIAL'),
  ...decision,
  create: OfficialCreate,
});
export const CreateDecision = Schema.Union([
  CreateTeamDecision,
  CreatePlayerDecision,
  CreateOfficialDecision,
]);
export type CreateDecision = typeof CreateDecision.Type;
export const ReviewDecision = Schema.Union([
  PickDecision,
  CreateTeamDecision,
  CreatePlayerDecision,
  CreateOfficialDecision,
]);
export type ReviewDecision = typeof ReviewDecision.Type;

// A reviewer's reply: decisions for what was listed, and whether the match
// may be written. Approval counts only once nothing is left unmatched; given
// earlier, it does not carry over to the next round.
export const ReviewReply = Schema.Struct({
  decisions: Schema.Array(ReviewDecision),
  approve: Schema.Boolean,
});
export type ReviewReply = typeof ReviewReply.Type;

// What a workflow is waiting on: the names still unsettled, and the records
// that the decisions so far will create, for the reviewer to see before
// approving.
export const PendingReview = Schema.Struct({
  unmatched: Schema.Array(Unmatched),
  creations: Schema.Array(CreateDecision),
});
export type PendingReview = typeof PendingReview.Type;

export class Matches extends HttpApiGroup.make('Matches').add(
  // Creation is asynchronous: the page is handed to an ingestion workflow and
  // the response carries its identifier. The body is the page's HTML as the
  // client's browser rendered it, sent as is; the source names its format.
  HttpApiEndpoint.post('create', '/matches', {
    query: { source: Source },
    payload: Schema.NonEmptyString.pipe(HttpApiSchema.asText({ contentType: 'text/html' })),
    success: Schema.Struct({ workflowId: Schema.String }).pipe(HttpApiSchema.status(202)),
  }),
  // The ingestion's progress. The output is whatever the workflow ended with,
  // opaque to the contract until the workflow ends with a match. While the
  // workflow waits for a reviewer, `review` carries what it is waiting on.
  HttpApiEndpoint.get('ingestion', '/matches/ingestions/:workflowId', {
    params: { workflowId: Schema.String },
    success: Schema.Struct({
      status: Schema.String,
      output: Schema.NullOr(Schema.Json),
      error: Schema.NullOr(Schema.Struct({ name: Schema.String, message: Schema.String })),
      review: Schema.NullOr(PendingReview),
    }),
  }),
  // The reviewer's reply, delivered to the waiting workflow, which matches
  // again with the decisions applied and writes the match once approved.
  HttpApiEndpoint.post('review', '/matches/ingestions/:workflowId/review', {
    params: { workflowId: Schema.String },
    payload: ReviewReply,
    success: Schema.Struct({ workflowId: Schema.String }).pipe(HttpApiSchema.status(202)),
  }),
) {}
