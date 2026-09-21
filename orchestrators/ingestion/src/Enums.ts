import * as Schema from 'effect/Schema';

export const Source = Schema.Literals(['FACR']);
export type Source = typeof Source.Type;

export const Side = Schema.Literals(['HOME', 'AWAY']);
export type Side = typeof Side.Type;

export const Sex = Schema.Literals(['FEMALE', 'MALE']);
export type Sex = typeof Sex.Type;

export const LineupRole = Schema.Literals(['STARTER', 'SUBSTITUTE']);
export type LineupRole = typeof LineupRole.Type;

export const GoalKind = Schema.Literals(['REGULAR', 'PENALTY', 'OWN_GOAL']);
export type GoalKind = typeof GoalKind.Type;

export const CardKind = Schema.Literals(['YELLOW', 'SECOND_YELLOW', 'RED']);
export type CardKind = typeof CardKind.Type;

export const OfficialRole = Schema.Literals([
  'REFEREE',
  'ASSISTANT_REFEREE',
  'FOURTH_OFFICIAL',
  'VIDEO_ASSISTANT_REFEREE',
  'DELEGATE',
]);
export type OfficialRole = typeof OfficialRole.Type;
