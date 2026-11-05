import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const ThreadGroupId = TrimmedNonEmptyString.check(Schema.isMaxLength(64));
export type ThreadGroupId = typeof ThreadGroupId.Type;

/** A named sidebar group an environment's threads can be moved into; list order is display order. */
export const ThreadGroup = Schema.Struct({
  id: ThreadGroupId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(80)),
});
export type ThreadGroup = typeof ThreadGroup.Type;

export const ThreadGroups = Schema.Array(ThreadGroup);
