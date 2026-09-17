import { useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import {
  Badge,
  Button,
  Field,
  Input,
  Textarea,
  Checkbox,
  Select,
  SelectOption,
  Table,
} from "@suite/ui-web";
import type {
  ConsoleSession,
  SubmissionDetail,
  SubmissionPage,
  ReviewAction,
} from "./contracts";
import "@suite/design-tokens";
import "@suite/ui-web/styles.css";
import "./style.css";
class ConsoleError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
async function request<T>(
  path: string,
  session?: ConsoleSession,
  payload?: unknown,
  method = payload === undefined ? "GET" : "POST",
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method,
    signal,
    headers: {
      "Content-Type": "application/json",
      ...(session ? { "x-csrf-token": session.csrf } : {}),
    },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  const result = await response.json();
  if (!response.ok)
    throw new ConsoleError(
      response.status,
      result.message ?? "The request failed.",
    );
  return result as T;
}
function App() {
  const [session, setSession] = useState<ConsoleSession>(),
    [code, setCode] = useState("");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [page, setPage] = useState<SubmissionPage>(),
    [offset, setOffset] = useState(0),
    [state, setState] = useState("pending"),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState("");
  const [selected, setSelected] = useState(""),
    [detail, setDetail] = useState<SubmissionDetail>(),
    [revision, setRevision] = useState(0);
  const [reason, setReason] = useState(""),
    [reviewed, setReviewed] = useState(false);
  const [clientFile, setClientFile] = useState<File>(),
    [serverFile, setServerFile] = useState<File>();
  const [notice, setNotice] = useState("");
  useEffect(() => {
    void request<ConsoleSession>("session")
      .then(setSession)
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!session) return;
    const abort = new AbortController();
    setPage(undefined);
    void request<SubmissionPage>(
      `submissions?state=${state}&search=${encodeURIComponent(query)}&offset=${offset}`,
      session,
      undefined,
      "GET",
      abort.signal,
    )
      .then(setPage)
      .catch((e: Error) => {
        if (!abort.signal.aborted) {
          setError(e.message);
          if (e instanceof ConsoleError && e.status === 401)
            setSession(undefined);
        }
      });
    return () => abort.abort();
  }, [session, state, query, offset, revision]);
  useEffect(() => {
    setDetail(undefined);
    setReason("");
    setReviewed(false);
    if (!selected || !session) return;
    const abort = new AbortController();
    void request<SubmissionDetail>(
      `submissions/${selected}`,
      session,
      undefined,
      "GET",
      abort.signal,
    )
      .then(setDetail)
      .catch((e: Error) => {
        if (!abort.signal.aborted) {
          setError(e.message);
          if (e instanceof ConsoleError && e.status === 401)
            setSession(undefined);
        }
      });
    return () => abort.abort();
  }, [selected, session, revision]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ConsoleError && e.status === 401) setSession(undefined);
    } finally {
      setBusy(false);
    }
  }
  async function act(action: ReviewAction) {
    await run(async () => {
      await request(`submissions/${selected}`, session, action);
      setRevision((v) => v + 1);
      setNotice(
        {
          approve: "Approval recorded.",
          reject: "Rejection recorded.",
          stage: "Server staging completed.",
          publish: "Release published to the registry.",
        }[action.action],
      );
    });
  }
  const problem = error ? (
    <p role="alert" className="console-error">
      {error}
    </p>
  ) : null;
  if (!session)
    return (
      <main className="console-unlock">
        <h1>Release review</h1>
        <p>
          Enter the access code from your operator terminal. Your database
          identity is recorded with every decision.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              setSession(
                await request<ConsoleSession>("session", undefined, { code }),
              );
              setCode("");
            });
          }}
        >
          <Field label="Console access code">
            <Input
              type="password"
              autoComplete="off"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </Field>
          {problem}
          <Button variant="primary" disabled={busy || !code} type="submit">
            Unlock console
          </Button>
        </form>
      </main>
    );
  return (
    <main className="registry-console">
      <header className="console-header">
        <div>
          <p className="console-eyebrow">Common operator tools</p>
          <h1>Release review</h1>
          <p>Signed module submissions, review decisions and publication.</p>
        </div>
        <div className="console-session">
          <span>Operator: {session.actor}</span>
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await request("session", session, undefined, "DELETE");
                setSession(undefined);
                setDetail(undefined);
                setSelected("");
              })
            }
          >
            Lock console
          </Button>
        </div>
      </header>
      {problem}
      <p role="status" className="console-notice">
        {notice}
      </p>
      <div className="console-grid">
        <section
          aria-label="Submission catalogue"
          className="console-catalogue"
        >
          <form
            className="console-filters"
            onSubmit={(e) => {
              e.preventDefault();
              setOffset(0);
              setQuery(search);
            }}
          >
            <Field label="Search modules">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                maxLength={100}
              />
            </Field>
            <Field label="Review state">
              <Select
                value={state}
                onValueChange={(v) => {
                  setState(v!);
                  setOffset(0);
                }}
              >
                {["pending", "approved", "rejected", "published", "all"].map(
                  (s) => (
                    <SelectOption key={s} value={s}>
                      {s[0].toUpperCase() + s.slice(1)}
                    </SelectOption>
                  ),
                )}
              </Select>
            </Field>
            <Button type="submit">Search</Button>
          </form>
          {!page ? (
            <p role="status">Loading submissions…</p>
          ) : (
            <>
              {!page.items.length ? (
                <p>No submissions match these filters.</p>
              ) : (
                <div className="console-table">
                  <Table>
                    <thead>
                      <tr>
                        <th scope="col">Module</th>
                        <th scope="col">State</th>
                        <th scope="col">Submitted by</th>
                      </tr>
                    </thead>
                    <tbody>
                      {page.items.map((item) => (
                        <tr key={item.id}>
                          <td>
                            <button
                              className="console-record"
                              disabled={busy}
                              onClick={() => {
                                setSelected(item.id);
                                setError("");
                                setNotice("");
                              }}
                            >
                              {item.module_id}
                              <small>{item.version}</small>
                            </button>
                          </td>
                          <td>
                            <Badge>{item.state}</Badge>
                          </td>
                          <td>{item.submitted_by}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              )}
              <nav aria-label="Submission pages" className="console-actions">
                <Button
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - 25))}
                >
                  Previous
                </Button>
                <span>Page {offset / 25 + 1}</span>
                <Button
                  disabled={page.next === null}
                  onClick={() => setOffset(page.next!)}
                >
                  Next
                </Button>
                <Button onClick={() => setRevision((v) => v + 1)}>
                  Refresh
                </Button>
              </nav>
            </>
          )}
          <details className="console-upload">
            <summary>Submit signed packages</summary>
            <p>
              Upload the client package and its matching server package when the
              module defines operations. Submission does not approve or publish
              a release.
            </p>
            <form
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                void run(async () => {
                  if (!clientFile) return;
                  const result = await request<{ id: string }>(
                    "submissions",
                    session,
                    {
                      client: JSON.parse(await clientFile.text()),
                      server: serverFile
                        ? JSON.parse(await serverFile.text())
                        : null,
                    },
                  );
                  setState("pending");
                  setOffset(0);
                  setSearch("");
                  setQuery("");
                  setSelected(result.id);
                  setRevision((v) => v + 1);
                  setNotice("Signed packages submitted for review.");
                });
              }}
            >
              <Field label="Client package">
                <input
                  type="file"
                  accept=".json,application/json"
                  required
                  onChange={(e) => setClientFile(e.target.files?.[0])}
                />
              </Field>
              <Field label="Server package (if required)">
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={(e) => setServerFile(e.target.files?.[0])}
                />
              </Field>
              <Button type="submit" disabled={busy || !clientFile}>
                Submit packages
              </Button>
            </form>
          </details>
        </section>
        <section aria-label="Submission review" className="console-review">
          {!selected ? (
            <div className="console-empty">
              <h2>Choose a submission</h2>
              <p>
                Inspect the exact signed contract and executable bytes before
                recording a decision.
              </p>
            </div>
          ) : !detail ? (
            <p role="status">Loading review…</p>
          ) : (
            <>
              <header>
                <Badge>{detail.state}</Badge>
                <h2>{detail.module_id}</h2>
                <p>Version {detail.version}</p>
              </header>
              <dl className="console-metadata">
                <dt>Publisher</dt>
                <dd>{detail.publisher_id}</dd>
                <dt>Backend</dt>
                <dd>{detail.backend_kind}</dd>
                <dt>Submitted</dt>
                <dd>
                  {new Date(detail.submitted_at).toLocaleString()} by{" "}
                  {detail.submitted_by}
                </dd>
                <dt>Host compatibility</dt>
                <dd>{String(detail.client_package.manifest.host)}</dd>
                <dt>Backend compatibility</dt>
                <dd>{String(detail.client_package.manifest.backend)}</dd>
                <dt>Client checksum</dt>
                <dd>
                  <code>{detail.client_digest}</code>
                </dd>
                {detail.server_digest && (
                  <>
                    <dt>Server checksum</dt>
                    <dd>
                      <code>{detail.server_digest}</code>
                    </dd>
                  </>
                )}
              </dl>
              <h3>Requested permissions</h3>
              <ul className="console-permissions">
                {(detail.client_package.manifest.permissions as string[]).map(
                  (p) => (
                    <li key={p}>
                      <code>{p}</code>
                    </li>
                  ),
                )}
              </ul>
              <details>
                <summary>Contract, configuration and dependencies</summary>
                <pre>
                  {JSON.stringify(
                    Object.fromEntries(
                      Object.entries(detail.client_package.artifact).filter(
                        ([key]) => key !== "client",
                      ),
                    ),
                    null,
                    2,
                  )}
                </pre>
              </details>
              <details>
                <summary>Exact client artifacts</summary>
                <pre>
                  {JSON.stringify(
                    detail.client_package.artifact.client ?? {
                      message: "This release uses generated resource views.",
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
              <details>
                <summary>Exact server artifact</summary>
                <pre>
                  {detail.server_package?.payload.javascript ??
                    "No independent server artifact."}
                </pre>
              </details>
              {detail.state === "pending" ? (
                <div className="console-decision">
                  <h3>Review decision</h3>
                  <p>
                    Decisions are permanent. Changes require a new module
                    version.
                  </p>
                  <Field label="Review reason">
                    <Textarea
                      value={reason}
                      maxLength={4000}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </Field>
                  <label className="console-check">
                    <Checkbox
                      checked={reviewed}
                      onCheckedChange={(v) => setReviewed(v === true)}
                    />
                    <span>
                      I reviewed the exact signed contract and artifacts.
                    </span>
                  </label>
                  <div className="console-actions">
                    <Button
                      variant="primary"
                      disabled={busy || !reviewed || !reason.trim()}
                      onClick={() => void act({ action: "approve", reason })}
                    >
                      Approve release
                    </Button>
                    <Button
                      variant="danger"
                      disabled={busy || !reviewed || !reason.trim()}
                      onClick={() => void act({ action: "reject", reason })}
                    >
                      Reject release
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="console-decision">
                  <h3>Recorded decision</h3>
                  <p>{detail.review_reason}</p>
                  <p>
                    {detail.reviewed_by}
                    {detail.reviewed_at
                      ? `, ${new Date(detail.reviewed_at).toLocaleString()}`
                      : ""}
                  </p>
                  {detail.state === "approved" && (
                    <div className="console-actions">
                      <Button
                        disabled={busy || !!detail.staged_at}
                        onClick={() => void act({ action: "stage" })}
                      >
                        {detail.staged_at ? "Server staged" : "Stage server"}
                      </Button>
                      <Button
                        variant="primary"
                        disabled={
                          busy ||
                          (detail.backend_kind !== "none" && !detail.staged_at)
                        }
                        onClick={() => void act({ action: "publish" })}
                      >
                        Publish release
                      </Button>
                    </div>
                  )}
                  {detail.state === "published" && (
                    <p>
                      The registry release is available. Each company still
                      controls entitlement, configuration and employee access.
                    </p>
                  )}
                </div>
              )}
              <h3>Review history</h3>
              <ol className="console-history">
                {detail.events.map((event) => (
                  <li key={event.id}>
                    <strong>{event.action}</strong>
                    <span>
                      {event.actor},{" "}
                      {new Date(event.created_at).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
