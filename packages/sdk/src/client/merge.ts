import type { JsonRecord } from "../authoring/module";

export interface FieldReview {
  base?: JsonRecord;
  local: JsonRecord;
  remote: JsonRecord;
  conflicts: string[];
  choices: Record<string, "local" | "remote">;
}
export function unresolvedReviewFields(review: FieldReview) {
  return review.conflicts.filter(
    (key) =>
      !Object.hasOwn(review.choices, key) ||
      !["local", "remote"].includes(review.choices[key]),
  );
}

/** Missing historical input requires explicit choices for every differing field. */
export function reviewFields(
  base: JsonRecord | undefined,
  local: JsonRecord,
  remote: JsonRecord,
) {
  const merged = base
    ? mergeFields(base, local, remote)
    : {
        data: { ...remote },
        conflicts: [
          ...new Set([...Object.keys(local), ...Object.keys(remote)]),
        ].filter(
          (key) => JSON.stringify(local[key]) !== JSON.stringify(remote[key]),
        ),
      };
  return {
    data: merged.data,
    review: {
      base: base && structuredClone(base),
      local: structuredClone(local),
      remote: structuredClone(remote),
      conflicts: merged.conflicts,
      choices: {},
    } satisfies FieldReview,
  };
}

export function chooseReviewField(
  review: FieldReview,
  data: JsonRecord,
  field: string,
  source: "local" | "remote",
) {
  if (!review.conflicts.includes(field))
    throw Error("Choose a field in this conflict review.");
  const present = Object.hasOwn(review[source], field);
  const next = present
    ? { ...data, [field]: structuredClone(review[source][field]) }
    : { ...data };
  if (!present) delete next[field];
  return {
    data: next,
    review: { ...review, choices: { ...review.choices, [field]: source } },
  };
}

/** Merge only fields unchanged on the server since the submitted base version. */
export function mergeFields(
  base: JsonRecord,
  local: JsonRecord,
  remote: JsonRecord,
): { data: JsonRecord; conflicts: string[] } {
  const data = { ...remote };
  const conflicts: string[] = [];
  for (const key of new Set([...Object.keys(base), ...Object.keys(local)])) {
    if (JSON.stringify(base[key]) === JSON.stringify(local[key])) continue;
    if (
      JSON.stringify(remote[key]) !== JSON.stringify(base[key]) &&
      JSON.stringify(remote[key]) !== JSON.stringify(local[key])
    )
      conflicts.push(key);
    else if (Object.hasOwn(local, key))
      Object.defineProperty(data, key, {
        value: local[key],
        enumerable: true,
        writable: true,
        configurable: true,
      });
    else delete data[key];
  }
  return { data, conflicts };
}
