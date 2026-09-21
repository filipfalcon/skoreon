import * as Schema from 'effect/Schema';

export const TeamKind = Schema.Literals(['CLUB', 'NATIONAL']);
export type TeamKind = typeof TeamKind.Type;

export const AssociationKind = Schema.Literals(['CONTINENTAL', 'GLOBAL', 'NATIONAL']);
export type AssociationKind = typeof AssociationKind.Type;

export const FifaCountry = Schema.Literals(['AUT', 'CZE', 'GER', 'POL', 'SVK']);
export type FifaCountry = typeof FifaCountry.Type;

export const GlobalAssociationCode = Schema.Literals(['FIFA']);
export type GlobalAssociationCode = typeof GlobalAssociationCode.Type;

export const ConfederationCode = Schema.Literals([
  'AFC',
  'CAF',
  'CONCACAF',
  'CONMEBOL',
  'OFC',
  'UEFA',
]);
export type ConfederationCode = typeof ConfederationCode.Type;

export const AssociationCode = Schema.Literals([
  ...GlobalAssociationCode.literals,
  ...ConfederationCode.literals,
  ...FifaCountry.literals,
]);
export type AssociationCode = typeof AssociationCode.Type;

export const PhaseFormat = Schema.Literals(['KNOCKOUT', 'LEAGUE']);
export type PhaseFormat = typeof PhaseFormat.Type;

export const PhaseRole = Schema.Literals(['QUALIFYING', 'MAIN']);
export type PhaseRole = typeof PhaseRole.Type;

export const PlayerPosition = Schema.Literals(['GOALKEEPER', 'DEFENDER', 'MIDFIELDER', 'FORWARD']);
export type PlayerPosition = typeof PlayerPosition.Type;

export const TiebreakerCriterion = Schema.Literals([
  'HEAD_TO_HEAD',
  'GOAL_DIFFERENCE',
  'GOALS_FOR',
  'WINS',
  'DISCIPLINARY_POINTS',
  'DRAWING_OF_LOTS',
]);
export type TiebreakerCriterion = typeof TiebreakerCriterion.Type;

export const SplitPointsCarryover = Schema.Literals(['FULL', 'HALVED']);
export type SplitPointsCarryover = typeof SplitPointsCarryover.Type;

export const Sex = Schema.Literals(['FEMALE', 'MALE']);
export type Sex = typeof Sex.Type;

export const Source = Schema.Literals(['FACR']);
export type Source = typeof Source.Type;
