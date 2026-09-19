import { createHash, randomBytes } from "node:crypto";
import * as oidc from "openid-client";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { DB } from "../persistence/database";
import type { LoginOptions, ProfileRecovery } from "@suite/contracts";
import type { Actor } from "./authorization";
import { AppError, requireCondition } from "../errors";
import { identify } from "./provision";
import type { ServerRuntime } from "../runtime/host";
export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export interface AuthConfig {
  mode: "development" | "oidc";
  issuer?: string;
  clientId?: string;
  clientSecret?: string;
  audience?: string;
  mfaClaim: string;
  origin: string;
  apiOrigin: string;
}
export function authConfig(): AuthConfig {
  const mode = process.env.AUTH_MODE === "development" ? "development" : "oidc";
  if (
    mode === "development" &&
    !["development", "test"].includes(process.env.NODE_ENV ?? "")
  )
    throw Error(
      "Development authentication requires NODE_ENV=development or test",
    );
  if (
    mode === "development" &&
    !["127.0.0.1", "localhost", "::1"].includes(process.env.HOST ?? "127.0.0.1")
  )
    throw Error("Development authentication must bind to loopback");
  if (
    mode === "oidc" &&
    (!process.env.AUTH0_ISSUER ||
      !process.env.AUTH0_CLIENT_ID ||
      !process.env.AUTH0_CLIENT_SECRET ||
      !process.env.AUTH0_AUDIENCE)
  )
    throw Error(
      "OIDC issuer, audience and confidential web client credentials are required",
    );
  const config = {
    mode,
    issuer: process.env.AUTH0_ISSUER,
    clientId: process.env.AUTH0_CLIENT_ID,
    clientSecret: process.env.AUTH0_CLIENT_SECRET,
    audience: process.env.AUTH0_AUDIENCE,
    mfaClaim: process.env.AUTH0_MFA_CLAIM ?? "https://suite.example/mfa",
    origin: process.env.APP_ORIGIN ?? "http://localhost:4300",
    apiOrigin: process.env.API_ORIGIN ?? "http://localhost:4310",
  };
  if (
    process.env.NODE_ENV === "production" &&
    (!config.origin.startsWith("https://") ||
      !config.apiOrigin.startsWith("https://") ||
      !config.issuer?.startsWith("https://"))
  )
    throw Error("Production origins and issuer must use HTTPS");
  return config as AuthConfig;
}
export function authentication(
  db: DB,
  config: AuthConfig,
  runtime: ServerRuntime,
) {
  let discovery: Promise<oidc.Configuration> | undefined;
  const client = () =>
    (discovery ??= oidc.discovery(
      new URL(config.issuer!),
      config.clientId!,
      config.clientSecret!,
    ));
  const jwks = config.issuer
    ? createRemoteJWKSet(new URL(".well-known/jwks.json", config.issuer))
    : undefined;
  return {
    async session(token?: string): Promise<Actor> {
      requireCondition(token, 401, "UNAUTHENTICATED", "Sign in to continue.");
      const row = await db
        .selectFrom("suite.sessions as s")
        .innerJoin("suite.users as u", "s.user_id", "u.id")
        .select([
          "u.id",
          "u.name",
          "u.email",
          "u.email_verified",
          "u.active",
          "s.csrf_token",
          "s.mfa",
          "s.created_at",
        ])
        .where("s.token_hash", "=", hashToken(token))
        .where("s.expires_at", ">", new Date())
        .executeTakeFirst();
      requireCondition(
        row?.active,
        401,
        "UNAUTHENTICATED",
        "Your session has expired. Sign in again.",
      );
      return {
        id: row.id,
        name: row.name,
        email: row.email,
        emailVerified: row.email_verified,
        mfa: row.mfa,
        csrfToken: row.csrf_token,
        authentication: {
          sessionId: hashToken(`profile-recovery:${row.csrf_token}`),
          authenticatedAt: row.created_at.toISOString(),
        },
      };
    },
    recovery(actor: Actor): ProfileRecovery {
      requireCondition(
        actor.emailVerified && actor.mfa,
        403,
        "MFA_REQUIRED",
        "Verify your email and sign in with multi-factor authentication to recover this profile.",
      );
      const authenticatedAt = actor.authentication
        ? Date.parse(actor.authentication.authenticatedAt)
        : NaN;
      const now = Date.now();
      requireCondition(
        actor.authentication &&
          Number.isFinite(authenticatedAt) &&
          authenticatedAt <= now &&
          now < authenticatedAt + 5 * 60_000,
        403,
        "REAUTHENTICATION_REQUIRED",
        "Sign in again before recovering this profile.",
      );
      return {
        userId: actor.id,
        ...actor.authentication,
        expiresAt: new Date(authenticatedAt + 5 * 60_000).toISOString(),
      };
    },
    async bearer(token: string): Promise<Actor> {
      requireCondition(
        config.mode === "oidc" && jwks,
        401,
        "UNAUTHENTICATED",
        "Native authentication is not configured.",
      );
      try {
        const { payload } = await jwtVerify(token, jwks, {
          issuer: config.issuer,
          audience: config.audience,
          algorithms: ["RS256"],
        });
        requireCondition(
          payload.sub,
          401,
          "UNAUTHENTICATED",
          "Invalid access token.",
        );
        let user = await db
          .selectFrom("suite.users")
          .selectAll()
          .where("issuer", "=", config.issuer!)
          .where("subject", "=", payload.sub)
          .executeTakeFirst();
        if (!user) {
          const profileResponse = await fetch(
            new URL("userinfo", config.issuer),
            {
              headers: { authorization: `Bearer ${token}` },
              signal: AbortSignal.timeout(10000),
            },
          );
          requireCondition(
            profileResponse.ok,
            401,
            "UNAUTHENTICATED",
            "Unable to verify this account.",
          );
          const profile = (await profileResponse.json()) as {
            sub: string;
            email: string;
            name?: string;
            email_verified?: boolean;
          };
          requireCondition(
            profile.sub === payload.sub && profile.email,
            401,
            "UNAUTHENTICATED",
            "Account identity could not be verified.",
          );
          user = await identify(
            db,
            {
              issuer: config.issuer!,
              subject: profile.sub,
              email: profile.email,
              name: profile.name ?? profile.email,
              emailVerified: profile.email_verified === true,
            },
            runtime,
          );
        }
        requireCondition(
          user.active,
          401,
          "UNAUTHENTICATED",
          "This account has been disabled.",
        );
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          emailVerified: user.email_verified,
          mfa: payload[config.mfaClaim] === true,
        };
      } catch (e) {
        if (e instanceof AppError) throw e;
        throw new AppError(
          401,
          "UNAUTHENTICATED",
          "Your session has expired. Sign in again.",
        );
      }
    },
    async issue(userId: string, mfa: boolean) {
      const token = randomBytes(32).toString("base64url");
      const csrfToken = randomBytes(24).toString("base64url");
      await db
        .insertInto("suite.sessions")
        .values({
          token_hash: hashToken(token),
          user_id: userId,
          csrf_token: csrfToken,
          mfa,
          expires_at: new Date(Date.now() + 8 * 3600000),
        })
        .execute();
      return { token, csrfToken };
    },
    async begin(options: LoginOptions = {}) {
      const c = await client();
      const state = oidc.randomState();
      const verifier = oidc.randomPKCECodeVerifier();
      const nonce = oidc.randomNonce();
      await db
        .deleteFrom("suite.login_attempts")
        .where("expires_at", "<", new Date())
        .execute();
      await db
        .insertInto("suite.login_attempts")
        .values({
          state_hash: hashToken(state),
          verifier,
          nonce,
          expires_at: new Date(Date.now() + 10 * 60000),
        })
        .execute();
      const url = oidc.buildAuthorizationUrl(c, {
        ...(options.loginHint ? { login_hint: options.loginHint } : {}),
        ...(options.screenHint ? { screen_hint: options.screenHint } : {}),
        prompt: "login",
        max_age: "0",
        redirect_uri: config.apiOrigin + "/auth/callback",
        scope: "openid profile email",
        state,
        nonce,
        code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
        code_challenge_method: "S256",
        acr_values:
          "http://schemas.openid.net/pape/policies/2007/06/multi-factor",
      });
      return { state, url: url.toString() };
    },
    async finish(url: URL, expectedState?: string) {
      const state = url.searchParams.get("state");
      requireCondition(
        state && state === expectedState,
        400,
        "INVALID_LOGIN",
        "The login attempt is invalid or expired.",
      );
      const attempt = await db
        .deleteFrom("suite.login_attempts")
        .where("state_hash", "=", hashToken(state))
        .where("expires_at", ">", new Date())
        .returningAll()
        .executeTakeFirst();
      requireCondition(
        attempt,
        400,
        "INVALID_LOGIN",
        "The login attempt is invalid or expired.",
      );
      const tokens = await oidc.authorizationCodeGrant(await client(), url, {
        pkceCodeVerifier: attempt.verifier,
        expectedState: state,
        expectedNonce: attempt.nonce,
        idTokenExpected: true,
        maxAge: 0,
      });
      const claims = tokens.claims()!;
      requireCondition(
        typeof claims.email === "string",
        400,
        "EMAIL_REQUIRED",
        "The identity provider must supply an email address.",
      );
      const user = await identify(
        db,
        {
          issuer: config.issuer!,
          subject: claims.sub,
          email: claims.email,
          name: typeof claims.name === "string" ? claims.name : claims.email,
          emailVerified: claims.email_verified === true,
        },
        runtime,
      );
      requireCondition(
        user.active,
        403,
        "ACCOUNT_DISABLED",
        "This account has been disabled.",
      );
      return {
        user,
        mfa:
          claims[config.mfaClaim] === true ||
          (Array.isArray(claims.amr) && claims.amr.includes("mfa")),
      };
    },
    async logout(token?: string) {
      if (token)
        await db
          .deleteFrom("suite.sessions")
          .where("token_hash", "=", hashToken(token))
          .execute();
    },
  };
}
