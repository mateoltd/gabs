import { checkSchema } from "@suite/module-sdk";
import {
  ReferenceOptionSchema,
  type ReferenceOption,
} from "@suite/module-sdk/references";

export const referenceCacheLimits = {
  targets: 50,
  options: 2000,
  perTarget: 200,
  bytes: 1024 * 1024,
} as const;
export interface ReferenceCacheState {
  referenceOptions?: Record<string, Record<string, ReferenceOption[]>>;
  referenceMetadata?: Record<
    string,
    Record<
      string,
      {
        downloadedAt: number;
        policyRevision?: string;
        labels: Record<string, number>;
      }
    >
  >;
}
const validTime = (value: number | undefined, now: number) =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value > 0 &&
  value <= now
    ? value
    : undefined;
export function referenceDownloadedAt(
  state: ReferenceCacheState,
  key: string,
  target: string,
  ids: string[],
  now = Date.now(),
): number | null {
  const metadata = state.referenceMetadata?.[key]?.[target];
  const times = ids.length
    ? ids.map((id) => validTime(metadata?.labels?.[id.toLowerCase()], now))
    : [validTime(metadata?.downloadedAt, now)];
  return times.every((time) => time !== undefined)
    ? Math.min(...(times as number[]))
    : null;
}
export function mergeReferenceOptions(
  old: ReferenceOption[],
  next: ReferenceOption[],
) {
  const options = new Map<string, ReferenceOption>();
  for (const item of [...old, ...next]) {
    options.delete(item.value.toLowerCase());
    options.set(item.value.toLowerCase(), item);
  }
  return [...options.values()].slice(-referenceCacheLimits.perTarget);
}
export function clearReferenceCache(state: ReferenceCacheState) {
  state.referenceOptions = {};
  state.referenceMetadata = {};
}
export function removeReferenceTarget(
  state: ReferenceCacheState,
  key: string,
  target: string,
) {
  if (state.referenceOptions?.[key]) {
    delete state.referenceOptions[key][target];
    if (!Object.keys(state.referenceOptions[key]).length)
      delete state.referenceOptions[key];
  }
  if (state.referenceMetadata?.[key]) {
    delete state.referenceMetadata[key][target];
    if (!Object.keys(state.referenceMetadata[key]).length)
      delete state.referenceMetadata[key];
  }
}
/** Conservative UTF-8 entry budget, including repeated keys and all timestamps. Never touches pending work. */
export function pruneReferenceCache(
  state: ReferenceCacheState,
  now = Date.now(),
): boolean {
  const before = JSON.stringify([
    state.referenceOptions,
    state.referenceMetadata,
  ]);
  if (!state.referenceOptions && !state.referenceMetadata) return false;
  const buckets = Object.entries(state.referenceOptions ?? {})
    .flatMap(([key, targets]) =>
      Object.entries(targets).map(([target, options]) => ({
        key,
        target,
        options,
        at:
          validTime(
            state.referenceMetadata?.[key]?.[target]?.downloadedAt,
            now,
          ) ?? 0,
      })),
    )
    .sort(
      (a, b) =>
        b.at - a.at ||
        a.key.localeCompare(b.key) ||
        a.target.localeCompare(b.target),
    );
  let bytes = 0,
    count = 0;
  const next: ReferenceCacheState = {
    referenceOptions: {},
    referenceMetadata: {},
  };
  for (const bucket of buckets.slice(0, referenceCacheLimits.targets)) {
    const { key, target, at } = bucket;
    const base = new TextEncoder().encode(
      JSON.stringify([
        key,
        target,
        [],
        {
          downloadedAt: at,
          labels: {},
          policyRevision:
            state.referenceMetadata?.[key]?.[target]?.policyRevision,
        },
      ]),
    ).byteLength;
    if (bytes + base > referenceCacheLimits.bytes) continue;
    bytes += base;
    const options = mergeReferenceOptions(
      [],
      (Array.isArray(bucket.options) ? bucket.options : []).filter((option) =>
        checkSchema(ReferenceOptionSchema, option),
      ),
    ).sort(
      (a, b) =>
        (validTime(
          state.referenceMetadata?.[key]?.[target]?.labels?.[
            b.value.toLowerCase()
          ],
          now,
        ) ?? 0) -
          (validTime(
            state.referenceMetadata?.[key]?.[target]?.labels?.[
              a.value.toLowerCase()
            ],
            now,
          ) ?? 0) || b.value.localeCompare(a.value),
    );
    const retained: ReferenceOption[] = [];
    const times: Record<string, number> = {};
    for (const option of options) {
      const time = validTime(
        state.referenceMetadata?.[key]?.[target]?.labels?.[
          option.value.toLowerCase()
        ],
        now,
      );
      const size = new TextEncoder().encode(
        JSON.stringify([
          key,
          target,
          option,
          option.value.toLowerCase(),
          time ?? null,
        ]),
      ).byteLength;
      if (
        count >= referenceCacheLimits.options ||
        bytes + size > referenceCacheLimits.bytes
      )
        continue;
      bytes += size;
      count++;
      retained.push(option);
      if (time) times[option.value.toLowerCase()] = time;
    }
    (next.referenceOptions![key] ??= {})[target] = retained.reverse();
    if (at)
      (next.referenceMetadata![key] ??= {})[target] = {
        downloadedAt: at,
        ...(state.referenceMetadata?.[key]?.[target]?.policyRevision
          ? {
              policyRevision:
                state.referenceMetadata[key][target].policyRevision,
            }
          : {}),
        labels: times,
      };
  }
  Object.assign(state, next);
  return (
    before !== JSON.stringify([state.referenceOptions, state.referenceMetadata])
  );
}
export function cacheReferenceOptions(
  state: ReferenceCacheState,
  key: string,
  target: string,
  incoming: ReferenceOption[],
  missing?: string,
  now = Date.now(),
  policyRevision?: string,
) {
  const options = (state.referenceOptions ??= {});
  const old = options[key]?.[target] ?? [];
  (options[key] ??= {})[target] = mergeReferenceOptions(
    old.filter((item) => item.value.toLowerCase() !== missing?.toLowerCase()),
    incoming,
  );
  const metadata = ((state.referenceMetadata ??= {})[key] ??= {});
  const labels = { ...metadata[target]?.labels };
  if (missing) delete labels[missing.toLowerCase()];
  for (const item of incoming) labels[item.value.toLowerCase()] = now;
  metadata[target] = {
    downloadedAt: now,
    labels,
    ...(policyRevision ? { policyRevision } : {}),
  };
  pruneReferenceCache(state, now);
}
