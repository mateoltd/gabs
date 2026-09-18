import { it, expect } from "vitest";
import { reviewFields, chooseReviewField } from "@suite/module-sdk";
it("preserves disjoint server changes and requires explicit overlapping choices including removal", () => {
  const base = {
    name: "Original",
    email: "old@example.test",
    phone: "123",
    preference: { paper: true },
  };
  const local = {
    name: "Local",
    email: base.email,
    preference: { paper: false },
  };
  const remote = {
    ...base,
    name: "Server",
    email: "new@example.test",
    phone: "456",
    preference: { paper: true, sms: true },
  };
  const initial = reviewFields(base, local, remote);
  expect(initial.review.conflicts).toEqual(["name", "phone", "preference"]);
  expect(initial.data.email).toBe("new@example.test");
  expect(initial.review.choices).toEqual({});
  let result = chooseReviewField(initial.review, initial.data, "name", "local");
  result = chooseReviewField(result.review, result.data, "phone", "local");
  result = chooseReviewField(
    result.review,
    result.data,
    "preference",
    "remote",
  );
  expect(result.data).toEqual({
    name: "Local",
    email: "new@example.test",
    preference: remote.preference,
  });
  expect(result.review.choices).toEqual({
    name: "local",
    phone: "local",
    preference: "remote",
  });
  expect(remote.phone).toBe("456");
  expect(() =>
    chooseReviewField(result.review, result.data, "email", "local"),
  ).toThrow("field in this conflict review");
});
it("does not infer intent for legacy input without original values and keeps review snapshots independent", () => {
  const local = { name: "Local", optional: null, active: false };
  const remote = { name: "Server", optional: "new", active: true, added: 1 };
  const result = reviewFields(undefined, local, remote);
  expect(result.review.conflicts).toEqual([
    "name",
    "optional",
    "active",
    "added",
  ]);
  expect(result.data).toEqual(remote);
  local.name = "Later";
  expect(result.review.local.name).toBe("Local");
  expect(
    chooseReviewField(result.review, result.data, "active", "local").data
      .active,
  ).toBe(false);
  expect(
    chooseReviewField(result.review, result.data, "optional", "local").data
      .optional,
  ).toBeNull();
});
it("treats prototype-named fields as data and never as an implicit review choice", async () => {
  const { mergeFields, unresolvedReviewFields } =
    await import("@suite/module-sdk");
  const base = JSON.parse('{"constructor":"old","__proto__":"old"}');
  const local = JSON.parse('{"constructor":"mine","__proto__":"mine"}');
  const remote = JSON.parse('{"constructor":"server","__proto__":"server"}');
  const initial = reviewFields(base, local, remote);
  expect(unresolvedReviewFields(initial.review)).toEqual([
    "constructor",
    "__proto__",
  ]);
  let result = chooseReviewField(
    initial.review,
    initial.data,
    "constructor",
    "local",
  );
  result = chooseReviewField(result.review, result.data, "__proto__", "remote");
  expect(unresolvedReviewFields(result.review)).toEqual([]);
  expect(JSON.stringify(result.data)).toBe(
    '{"constructor":"mine","__proto__":"server"}',
  );
  expect(Object.getPrototypeOf(result.data)).toBe(Object.prototype);
  expect(mergeFields(base, {}, base).data).toEqual({});
  expect(JSON.stringify(mergeFields(base, local, base).data)).toBe(
    JSON.stringify(local),
  );
});
