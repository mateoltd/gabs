import { describe, it, expect } from "vitest";
import { applyStockEffect } from "../modules/inventory/domain";
import { transition, validateDraft } from "../modules/orders/domain";
import { canReadSnapshot, type Snapshot } from "../packages/platform/src";
import {
  validateOperation,
  validateScope,
  trustedSender,
  validateLogin,
} from "../apps/desktop/src/security";
import { randomUUID } from "node:crypto";
describe("business invariants", () => {
  it("reserves, fulfills and releases without inventing stock", () => {
    const original = { onHand: 10, reserved: 0 };
    const reserved = applyStockEffect(original, "reservation", 4);
    expect(reserved).toEqual({ onHand: 10, reserved: 4 });
    expect(applyStockEffect(reserved, "fulfillment", 4)).toEqual({
      onHand: 6,
      reserved: 0,
    });
    expect(applyStockEffect(reserved, "release", 4)).toEqual(original);
  });
  it("rejects invalid movements and adjustments below reservations", () => {
    expect(() =>
      applyStockEffect({ onHand: 10, reserved: 9 }, "adjustment", -2),
    ).toThrow();
    expect(() =>
      applyStockEffect({ onHand: 1, reserved: 0 }, "reservation", 2),
    ).toThrow();
    expect(() =>
      applyStockEffect({ onHand: 10, reserved: 0 }, "receipt", 1.5),
    ).toThrow();
  });
  it("locks the order lifecycle after fulfillment or cancellation", () => {
    expect(transition("draft", "confirm")).toBe("confirmed");
    expect(transition("confirmed", "fulfill")).toBe("fulfilled");
    expect(() => transition("fulfilled", "cancel")).toThrow();
    expect(() => transition("cancelled", "confirm")).toThrow();
  });
  it("rejects duplicate products and unsafe totals", () => {
    const id = randomUUID();
    expect(() =>
      validateDraft({
        customerName: "A",
        lines: [
          { productId: id, quantity: 1, priceMinor: 100 },
          { productId: id, quantity: 2, priceMinor: 100 },
        ],
      }),
    ).toThrow();
    expect(() =>
      validateDraft({
        customerName: "A",
        lines: [{ productId: id, quantity: 1000000, priceMinor: 100000000 }],
      }),
    ).toThrow();
  });
});
describe("offline and native boundaries", () => {
  it("allows sign-in hints without letting a renderer override the OAuth destination or proof", () => {
    expect(
      validateLogin({
        loginHint: "alex+work@example.com",
        screenHint: "signup",
      }),
    ).toEqual({ loginHint: "alex+work@example.com", screenHint: "signup" });
    expect(validateLogin(undefined)).toEqual({});
    for (const options of [
      null,
      [],
      { loginHint: "invalid" },
      { screenHint: "login" },
      { redirect_uri: "https://evil.example" },
      { state: "chosen-by-renderer" },
      { code_challenge: "bad" },
    ]) {
      expect(() => validateLogin(options)).toThrow("Invalid sign-in options");
    }
  });
  it("expires offline access without treating data as remotely erased", () => {
    const snapshot = {
      expiresAt: 200,
      cachedAt: 100,
      bootstrap: { offlineHours: 24 },
    } as Snapshot;
    expect(canReadSnapshot(snapshot, 150)).toBe(true);
    expect(canReadSnapshot(snapshot, 200)).toBe(false);
    expect(canReadSnapshot(snapshot, 50)).toBe(false);
    expect(
      canReadSnapshot(
        { ...snapshot, bootstrap: { offlineHours: 0 } } as Snapshot,
        150,
      ),
    ).toBe(false);
  });
  it("rejects arbitrary native URLs, routes and filesystem scopes", () => {
    const moduleRequest = {
      operation: "moduleRequest",
      params: { workspaceId: randomUUID(), moduleId: "contacts" },
      moduleVersion: "1.1.0",
    };
    expect(validateOperation(moduleRequest).moduleVersion).toBe("1.1.0");
    expect(
      validateOperation({
        ...moduleRequest,
        operation: "moduleCapabilityAuthorize",
        body: { capability: "export" },
      }).moduleVersion,
    ).toBe("1.1.0");
    expect(
      validateOperation({
        ...moduleRequest,
        operation: "moduleQuery",
        params: { ...moduleRequest.params, operationName: "overview" },
      }).moduleVersion,
    ).toBe("1.1.0");
    const references = {
      ...moduleRequest,
      operation: "moduleReferences",
      params: { ...moduleRequest.params, resource: "notes" },
      query: {
        field: "/properties/contactId",
        limit: 25,
        selected: randomUUID(),
      },
    };
    expect(validateOperation(references).query).toEqual(references.query);
    for (const query of [
      undefined,
      { ...references.query, field: "" },
      { ...references.query, limit: 101 },
      { ...references.query, selected: "invalid" },
      { ...references.query, target: "foreign" },
    ])
      expect(() => validateOperation({ ...references, query })).toThrow();
    expect(() =>
      validateOperation({ ...references, operation: "moduleMembers" }),
    ).toThrow();
    const fleetRequest = {
      operation: "moduleFleet",
      params: { workspaceId: crypto.randomUUID(), moduleId: "contacts" },
      query: { offset: 50 },
    };
    expect(validateOperation(fleetRequest).query?.offset).toBe(50);
    for (const offset of [-1, 1.5, "50", 1000001])
      expect(() =>
        validateOperation({ ...fleetRequest, query: { offset } }),
      ).toThrow();
    expect(() =>
      validateOperation({ ...fleetRequest, operation: "platformState" }),
    ).toThrow();
    expect(() =>
      validateOperation({
        ...moduleRequest,
        moduleVersion: "1.0.0\r\nAuthorization: evil",
      }),
    ).toThrow();
    expect(() =>
      validateOperation({ ...moduleRequest, operation: "me" }),
    ).toThrow();
    expect(() =>
      validateOperation({ operation: "fetch", url: "file:///etc/passwd" }),
    ).toThrow();
    expect(() =>
      validateOperation({
        operation: "orderGet",
        params: { workspaceId: randomUUID(), id: "../../secret" },
      }),
    ).toThrow();
    expect(() =>
      validateScope(
        { userId: randomUUID(), workspaceId: "../../secret" },
        randomUUID(),
      ),
    ).toThrow();
    expect(trustedSender("https://app/")).toBe(false);
    expect(trustedSender("suite://evil/index.html")).toBe(false);
    expect(trustedSender("suite://app/index.html")).toBe(true);
  });
});
