import { Select, SelectOption, Input } from "@suite/ui-web";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { LoginOptions } from "@suite/contracts";
import { Button, ErrorMessage, Field, Modal } from "@suite/ui-web";
import { ArrowRight, ShieldCheck, AlertCircle } from "@suite/ui-web/icons";
import { SignInArtwork } from "../../app/artwork";
import { AppUpdate } from "../../app/update";
import { BrandIcon } from "../../app/brand";

export function Login() {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"development" | "oidc" | "unconfigured">();
  const [account, setAccount] = useState("owner@demo.local");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [help, setHelp] = useState(false);
  useEffect(() => {
    let active = true;
    const status = window.suiteDesktop
      ? window.suiteDesktop.authStatus()
      : fetch("/auth/config").then(async (response) => {
          if (!response.ok)
            throw Error(
              "Sign-in is unavailable. Check your connection and reload to try again.",
            );
          return response.json();
        });
    void status
      .then((value) => {
        if (!active) return;
        if (!["development", "oidc", "unconfigured"].includes(value.mode))
          throw Error("Sign-in is unavailable. Please try again later.");
        setMode(value.mode);
      })
      .catch((value) => {
        if (active) setError(value);
      });
    return () => {
      active = false;
    };
  }, []);

  async function signIn(options: LoginOptions = {}) {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    let redirecting = false;
    try {
      if (window.suiteDesktop) await window.suiteDesktop.login(options);
      else if (mode === "development") {
        const response = await fetch("/auth/development", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: account }),
        });
        if (!response.ok) throw Error((await response.json()).message);
      } else {
        const query = new URLSearchParams(options);
        redirecting = true;
        window.location.assign(`/auth/login${query.size ? `?${query}` : ""}`);
        return;
      }
      localStorage.removeItem("suite-logout-pending");
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      if (!window.suiteDesktop)
        localStorage.setItem("suite-session-change", crypto.randomUUID());
    } catch (value) {
      setError(value);
    } finally {
      if (!redirecting) setBusy(false);
    }
  }

  return (
    <main className="login">
      <section className="login-form" aria-labelledby="login-heading">
        <div className="login-header" aria-hidden="true" />
        <div className="login-form-center">
          <div className="login-form-inner" aria-busy={busy}>
            <BrandIcon size={32} />
            <h1 id="login-heading">Sign in to Common</h1>
            <ErrorMessage error={error} />
            {mode === "unconfigured" ? (
              <div className="notice" role="status">
                <strong>Desktop sign-in is not configured</strong>
                <p>
                  This build is missing its sign-in settings. Use the local
                  development app to try the pilot, or ask your administrator
                  for a configured installer.
                </p>
              </div>
            ) : mode === "development" ? (
              <form
                className="form-stack"
                onSubmit={(event) => {
                  event.preventDefault();
                  void signIn();
                }}
              >
                <p className="login-description">
                  {window.suiteDesktop
                    ? "Open your workspaces as Alex Morgan, Owner."
                    : "Choose an account to explore the demo workspace."}
                </p>
                {!window.suiteDesktop && (
                  <Field label="Local demonstration account">
                    <Select
                      value={account}
                      disabled={busy}
                      onValueChange={(event) => setAccount(event)}
                    >
                      <SelectOption value="owner@demo.local">
                        Alex Morgan (Owner)
                      </SelectOption>
                      <SelectOption value="sales@demo.local">
                        Sam Rivera (Sales)
                      </SelectOption>
                      <SelectOption value="warehouse@demo.local">
                        Jamie Chen (Warehouse)
                      </SelectOption>
                      <SelectOption value="viewer@demo.local">
                        Taylor Kim (Viewer)
                      </SelectOption>
                    </Select>
                  </Field>
                )}
                <Button type="submit" variant="primary" disabled={busy}>
                  {busy
                    ? "Signing in…"
                    : window.suiteDesktop
                      ? "Open local workspace"
                      : "Open workspace"}
                  <ArrowRight size={18} />
                </Button>
                <p className="login-note">
                  Demo accounts use sample data. No password is needed.
                </p>
              </form>
            ) : mode === "oidc" ? (
              <>
                <Button disabled={busy} onClick={() => void signIn()}>
                  <ShieldCheck size={20} />
                  Use single sign-on
                </Button>
                <div className="login-divider">
                  <span>or</span>
                </div>
                <form
                  className="form-stack"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void signIn({ loginHint: email.trim() });
                  }}
                >
                  <Field label="Email address">
                    <Input
                      name="email"
                      type="email"
                      autoComplete="username"
                      inputMode="email"
                      placeholder="you@company.com"
                      required
                      maxLength={254}
                      value={email}
                      disabled={busy}
                      onChange={(event) => setEmail(event.target.value)}
                      aria-describedby="login-next-step"
                    />
                  </Field>
                  <Button type="submit" variant="primary" disabled={busy}>
                    {busy ? "Signing in…" : "Sign in"}
                    <ArrowRight size={18} />
                  </Button>
                  <p className="login-note" id="login-next-step">
                    You’ll enter your password or choose another sign-in method
                    on the next screen.
                  </p>
                </form>
                <p className="login-signup">
                  New to Common?{" "}
                  <button
                    type="button"
                    className="text-link"
                    disabled={busy}
                    onClick={() => void signIn({ screenHint: "signup" })}
                  >
                    Create an account
                  </button>
                </p>
              </>
            ) : !error ? (
              <div className="login-loading" role="status">
                Preparing sign-in…
              </div>
            ) : (
              <Button onClick={() => window.location.reload()}>
                Try again
              </Button>
            )}
            <div className="login-local-access">
              <button
                type="button"
                className="text-link"
                disabled={busy}
                onClick={() =>
                  window.dispatchEvent(new Event("suite-local-mode"))
                }
              >
                Use a local profile
              </button>
            </div>
          </div>
        </div>
        <footer className="login-footer">
          <span>
            {mode === "development"
              ? "Local workspace preview"
              : "Account access"}
          </span>
          <div className="login-footer-actions">
            <AppUpdate placement="signin" />
            <button
              type="button"
              className="login-help"
              onClick={() => setHelp(true)}
            >
              <AlertCircle size={18} />
              Help
            </button>
          </div>
        </footer>
      </section>
      <SignInArtwork />
      <Modal
        open={help}
        onOpenChange={setHelp}
        title="Sign-in help"
        description="Signing in and joining your workspace."
      >
        {mode === "development" ? (
          <p>
            This is the local pilot. Choose a demo account to try its assigned
            role. Company workspaces and personal workspaces remain separate.
          </p>
        ) : (
          <div className="form-stack">
            <p>
              Continue with your email or use your organization’s single
              sign-on. Available providers, password recovery, and account
              creation are managed on the secure sign-in screen.
            </p>
            <p>
              If your company invited you, sign in with the email address that
              received the invitation. For access to a workspace, contact its
              administrator.
            </p>
            {window.suiteDesktop && (
              <p>
                Desktop sign-in opens your default browser. Return to Common
                after completing the sign-in steps.
              </p>
            )}
          </div>
        )}
      </Modal>
    </main>
  );
}
