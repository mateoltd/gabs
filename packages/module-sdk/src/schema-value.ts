/** Present JSON objects to validators without inherited Object.prototype fields. */
export function ownSchemaValue(value: unknown): unknown {
  const seen = new WeakMap<object, unknown>();
  function copy(value: unknown): unknown {
    if (!value || typeof value !== "object") return value;
    if (seen.has(value)) return seen.get(value);
    if (Array.isArray(value)) {
      const result: unknown[] = [];
      seen.set(value, result);
      for (const item of value) result.push(copy(item));
      return result;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return value;
    const result: Record<string, unknown> = Object.create(null);
    seen.set(value, result);
    for (const [key, item] of Object.entries(value)) result[key] = copy(item);
    return result;
  }
  return copy(value);
}
