import { FifaCountry, PlayerPosition, Sex } from '#Enums';
import * as Schema from 'effect/Schema';
import * as HttpApiEndpoint from 'effect/unstable/httpapi/HttpApiEndpoint';
import * as HttpApiGroup from 'effect/unstable/httpapi/HttpApiGroup';

export const Player = Schema.Struct({
  id: Schema.String,
  primaryPosition: PlayerPosition,
  person: Schema.Struct({
    id: Schema.String,
    givenName: Schema.String,
    familyName: Schema.String,
    sex: Sex,
    nationality: FifaCountry,
    dateOfBirth: Schema.String,
  }),
  currentClub: Schema.NullOr(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
    }),
  ),
});

// Query strings arrive as text; a page index is a finite integer or it is not a page index.
const IntFromString = Schema.FiniteFromString.pipe(Schema.decodeTo(Schema.Int));

export const PlayerPage = Schema.Struct({
  items: Schema.Array(Player),
  total: Schema.Int,
  page: Schema.Int,
  pageSize: Schema.Int,
});

export class Players extends HttpApiGroup.make('Players').add(
  HttpApiEndpoint.get('list', '/players', {
    query: {
      page: Schema.optional(IntFromString),
      pageSize: Schema.optional(IntFromString),
    },
    success: PlayerPage,
  }),
) {}
