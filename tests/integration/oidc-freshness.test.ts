import "dotenv/config";
import { it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { connectDatabase } from "../../composition/src/server/product";

const provider = vi.hoisted(() => ({
  nonce: "",
  subject: "",
  age: "fresh" as "fresh" | "missing" | "stale",
}));

// Only discovery and the provider's transport are controlled. Production login
// persistence and openid-client's code/nonce/auth_time checks execute unchanged.
vi.mock("openid-client", async (original) => {
  const oidc = await original<typeof import("openid-client")>();
  const { SignJWT, generateKeyPair } = await import("jose");
  const { privateKey } = await generateKeyPair("RS256");
  return {
    ...oidc,
    discovery: async () => {
      const config = new oidc.Configuration(
        {
          issuer: "https://identity.test/",
          authorization_endpoint: "https://identity.test/authorize",
          token_endpoint: "https://identity.test/token",
        },
        "recovery-client",
        "test-only-client-secret",
      );
      config[oidc.customFetch] = async (url) => {
        expect(String(url)).toBe("https://identity.test/token");
        const now = Math.floor(Date.now() / 1000);
        const token = await new SignJWT({
          nonce: provider.nonce,
          email: `${provider.subject}@test.local`,
          email_verified: true,
          amr: ["mfa"],
          ...(provider.age === "missing"
            ? {}
            : { auth_time: now - (provider.age === "stale" ? 600 : 0) }),
        })
          .setProtectedHeader({ alg: "RS256" })
          .setIssuer("https://identity.test/")
          .setAudience("recovery-client")
          .setSubject(provider.subject)
          .setIssuedAt(now)
          .setExpirationTime(now + 300)
          .sign(privateKey);
        return new Response(
          JSON.stringify({
            access_token: "test-access",
            token_type: "Bearer",
            expires_in: 300,
            id_token: token,
          }),
          { headers: { "content-type": "application/json" } },
        );
      };
      return config;
    },
  };
});

it.each(["fresh", "missing", "stale"] as const)(
  "requires fresh provider authentication and checks the returned auth_time: %s",
  async (age) => {
    const { createApp } = await import("../../apps/api/src/app");
    const db = connectDatabase();
    const server = await createApp({
      db,
      auth: {
        mode: "oidc",
        issuer: "https://identity.test/",
        clientId: "recovery-client",
        clientSecret: "test-only-client-secret",
        audience: "suite-test",
        origin: "http://localhost:4300",
        apiOrigin: "http://localhost:4310",
        mfaClaim: "mfa",
      },
    });
    try {
      provider.subject = randomUUID();
      provider.age = age;
      const started = await server.auth.begin({
        loginHint: "account@test.local",
      });
      const authorization = new URL(started.url);
      expect(authorization.searchParams.get("prompt")).toBe("login");
      expect(authorization.searchParams.get("max_age")).toBe("0");
      expect(authorization.searchParams.get("login_hint")).toBe(
        "account@test.local",
      );
      provider.nonce = authorization.searchParams.get("nonce")!;
      const callback = new URL("http://localhost:4310/auth/callback");
      callback.searchParams.set("code", "test-authorization-code");
      callback.searchParams.set("state", started.state);
      if (age === "fresh") {
        const result = await server.auth.finish(callback, started.state);
        expect(result.mfa).toBe(true);
        expect(result.user.email).toBe(`${provider.subject}@test.local`);
        const session = await server.auth.issue(result.user.id, result.mfa);
        const actor = await server.auth.session(session.token);
        expect(server.auth.recovery(actor).userId).toBe(result.user.id);
      } else {
        await expect(
          server.auth.finish(callback, started.state),
        ).rejects.toMatchObject({
          cause:
            age === "missing"
              ? { message: expect.stringContaining('"auth_time"') }
              : { cause: { claim: "auth_time" } },
        });
        expect(
          await db
            .selectFrom("suite.users")
            .select("id")
            .where("email", "=", `${provider.subject}@test.local`)
            .executeTakeFirst(),
        ).toBeUndefined();
      }
      // Every callback is one-shot, including an invalid provider response.
      await expect(
        server.auth.finish(callback, started.state),
      ).rejects.toMatchObject({ code: "INVALID_LOGIN" });
    } finally {
      await server.app.close();
      await db.destroy();
    }
  },
);
