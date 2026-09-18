import { expect, it, vi } from "vitest";
import { isDefinitiveRejection } from "@suite/module-sdk/sync";
import type { ModuleCall } from "@suite/module-sdk";
import { settleModuleCall } from "../../packages/client/src/modules/settlement";

it("only releases an identity on a definitive first rejection", () => {
  for (const status of [400, 403, 404, 409, 412, 422]) {
    expect(isDefinitiveRejection({ status }, false)).toBe(true);
    expect(isDefinitiveRejection({ status }, true)).toBe(false);
  }
  for (const status of [401, 408, 429, 500, 503, undefined])
    expect(isDefinitiveRejection({ status }, false)).toBe(false);
  for (const code of [
    "MEMBERSHIP_REVOKED",
    "MFA_REQUIRED",
    "INVALID_RESOURCE_RESPONSE",
    "MODULE_RESPONSE_CONTRACT_UNAVAILABLE",
  ])
    expect(isDefinitiveRejection({ status: 403, code }, false)).toBe(false);
  expect(isDefinitiveRejection(new TypeError("Lost reply"), false)).toBe(false);
});

it("settles the exact direct request and validates acceptance before returning", async () => {
  const call: ModuleCall = {
    moduleId: "contacts",
    moduleVersion: "1.1.0",
    resource: "contacts",
    action: "archive",
    input: { id: "record", baseVersion: 3 },
    key: "original-request",
  };
  const validate = vi.fn(async () => {});
  const settle = vi.fn(async () => ({
    key: call.key,
    outcome: "accepted",
    result: { version: 4 },
  }));
  await expect(settleModuleCall(call, settle, validate)).resolves.toMatchObject(
    { outcome: "accepted" },
  );
  expect(settle).toHaveBeenCalledWith({
    moduleId: "contacts",
    moduleVersion: "1.1.0",
    body: {
      key: "original-request",
      call: { action: "archive", resource: "contacts", input: call.input },
    },
  });
  expect(validate).toHaveBeenCalledWith({ version: 4 });
  await expect(
    settleModuleCall(call, settle, async () => {
      throw Error("Invalid original response");
    }),
  ).rejects.toThrow("Invalid original response");
  validate.mockClear();
  await expect(
    settleModuleCall(
      call,
      async () => ({
        key: "different-request",
        outcome: "accepted",
        result: {},
      }),
      validate,
    ),
  ).rejects.toThrow("different change");
  expect(validate).not.toHaveBeenCalled();
  await expect(
    settleModuleCall(
      call,
      async () => ({ key: call.key, outcome: "cancelled" }),
      validate,
    ),
  ).resolves.toEqual({ key: call.key, outcome: "cancelled" });
  expect(validate).not.toHaveBeenCalled();
  await expect(
    settleModuleCall({ ...call, key: undefined }, settle, validate),
  ).rejects.toThrow("original retry identity");
});
