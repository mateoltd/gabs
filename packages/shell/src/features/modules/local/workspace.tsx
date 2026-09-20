import { LocalProfileUnlock } from "./profile-unlock";
import { type LocalUnlockStatus } from "@suite/client/local-unlock";
import { createSchemaDraft } from "@suite/module-sdk/forms";
import { ProfileRecovery } from "./profile-recovery";
import { LocalActions } from "./actions";
import { LocalDeviceRequests } from "./devices/requests";
import { LocalModules, type LocalRegistry } from "./modules";
import {
  TypedResourceTable,
  TypedResourceRanges,
  TypedResourceSort,
} from "@suite/ui-web";
import { listResourceRecords } from "@suite/module-sdk/queries";
import { useEffect, useState, useMemo, useRef } from "react";
import {
  createModuleClient,
  type ResourceRecord,
  type TObject,
  type ResourceRangeBounds,
  type ResourceSort,
} from "@suite/module-sdk";
import {
  availableLocalModules,
  listLocalProfiles,
  localVaultProvider,
  createLocalProfile,
  unlockLocalProfile,
  unlockLocalProfileWith,
  removeLocalProfile,
  subscribeLocalProfiles,
  type LocalSession,
} from "@suite/client/local-profiles";
import {
  Button,
  Field,
  Input,
  Select,
  SelectOption,
  SchemaForm,
  Modal,
  PageHeading,
  ErrorMessage,
  type FormSchema,
  Empty,
  fieldLabel,
} from "@suite/ui-web";
import { BrandIcon } from "../../../app/brand";
import { useShellComposition } from "../../../app/composition";
export function LocalWorkspace({
  onExit,
  registry,
}: {
  onExit: () => void;
  registry?: LocalRegistry;
}) {
  const { catalog, localProfiles } = useShellComposition();
  const [profiles, setProfiles] = useState<{ id: string; name: string }[]>([]),
    [id, setId] = useState(""),
    [name, setName] = useState(""),
    [password, setPassword] = useState(""),
    [session, setSession] = useState<LocalSession>(),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [removing, setRemoving] = useState(false);
  const [revision, setRevision] = useState(0);
  const [unlockMethod, setUnlockMethod] = useState<"passphrase" | "pin">(
    "passphrase",
  );
  const [unlockStatus, setUnlockStatus] = useState<LocalUnlockStatus>();
  const [unlockNotice, setUnlockNotice] = useState("");
  useEffect(() => {
    let current = true;
    setUnlockStatus(undefined);
    setUnlockMethod("passphrase");
    if (id && !session)
      void localVaultProvider(localProfiles)
        .status(id)
        .then((value) => {
          if (current) setUnlockStatus(value);
        })
        .catch((error) => {
          if (current) setError(error);
        });
    return () => {
      current = false;
    };
  }, [id, session, localProfiles]);
  const unlockEpoch = useRef(0);
  const activeSession = useRef<LocalSession | undefined>(undefined);
  const selectedProfileId = useRef("");
  const pendingSignIn = useRef(false);
  const selectProfile = (value: string) => {
    selectedProfileId.current = value;
    setId(value);
  };
  const resources = useMemo(
    () =>
      availableLocalModules(session?.data ?? { records: {} }, catalog).flatMap(
        (m) =>
          Object.entries(m.resources)
            .sort(([a], [b]) =>
              a === m.id ? -1 : b === m.id ? 1 : a.localeCompare(b),
            )
            .filter(([, r]) => r.standalone)
            .map(([id, r]) => ({
              key: `${m.id}/${id}`,
              module: m,
              resource: r,
            })),
      ),
    [catalog, session, revision],
  );
  const [key, setKey] = useState(resources[0]?.key ?? ""),
    [form, setForm] = useState<Record<string, unknown>>({}),
    [editing, setEditing] = useState<ResourceRecord | null | undefined>();
  const selected = resources.find((r) => r.key === key) ?? resources[0];
  const rangeScope = `${session?.id}/${selected?.key}@${selected?.module.version}`;
  const [rangeState, setRangeState] = useState<{
    scope: string;
    value: Record<string, ResourceRangeBounds>;
  }>();
  const ranges = useMemo(
    () => (rangeState?.scope === rangeScope ? rangeState.value : {}),
    [rangeState, rangeScope],
  );
  const setRanges = (value: Record<string, ResourceRangeBounds>) =>
    setRangeState({ scope: rangeScope, value });
  const [orderState, setOrderState] = useState<{
    scope: string;
    value: ResourceSort[];
  }>();
  const orderBy = useMemo(
    () => (orderState?.scope === rangeScope ? orderState.value : []),
    [orderState, rangeScope],
  );
  const setOrderBy = (value: ResourceSort[]) =>
    setOrderState({ scope: rangeScope, value });
  const [cursorState, setCursorState] = useState<{
    scope: string;
    value?: string;
  }>();
  const cursor =
    cursorState?.scope === rangeScope ? cursorState.value : undefined;
  const setCursor = (value: string | undefined) =>
    setCursorState({ scope: rangeScope, value });
  const [previousState, setPreviousState] = useState<{
    scope: string;
    value: (string | undefined)[];
  }>();
  const previous =
    previousState?.scope === rangeScope ? previousState.value : [];
  const setPrevious = (value: (string | undefined)[]) =>
    setPreviousState({ scope: rangeScope, value });
  useEffect(() => {
    setCursor(undefined);
    setPrevious([]);
    setRanges({});
    setOrderBy([]);
  }, [rangeScope]);
  const page = useMemo(() => {
    try {
      return {
        ...(selected && session
          ? listResourceRecords(
              selected.resource.schema,
              session.data.records[selected.key] ?? [],
              { limit: 50, cursor, ranges, orderBy },
              `${session.id}/${selected.module.id}@${selected.module.version}/${selected.key.slice(selected.module.id.length + 1)}`,
            )
          : { items: [], nextCursor: null }),
        error: undefined as unknown,
      };
    } catch (error) {
      return { items: [], nextCursor: null, error };
    }
  }, [selected, session, revision, cursor, ranges, orderBy, rangeScope]);
  const referenceLoader = useMemo(() => {
    if (!selected || !session) return undefined;
    return createModuleClient(selected.module, (call, options) =>
      session.execute(selected.module, call, options),
    ).resource(selected.key.slice(selected.module.id.length + 1))
      .loadReferences;
  }, [selected?.module, selected?.key, session, revision]);
  useEffect(() => {
    if (selected && selected.key !== key) {
      setKey(selected.key);
      setEditing(undefined);
      setForm({});
    }
  }, [selected?.key, key]);
  useEffect(() => {
    let active = true,
      refreshSequence = 0;
    const refreshProfiles = () => {
      const sequence = ++refreshSequence;
      void listLocalProfiles(localProfiles)
        .then((profiles) => {
          if (active && sequence === refreshSequence) setProfiles(profiles);
        })
        .catch((error) => {
          if (active && sequence === refreshSequence) setError(error);
        });
    };
    refreshProfiles();
    const stop = subscribeLocalProfiles((changedId, invalidate = true) => {
      const current = activeSession.current;
      if (
        invalidate &&
        (changedId === selectedProfileId.current || changedId === current?.id)
      )
        unlockEpoch.current++;
      if (invalidate && current?.id === changedId) {
        activeSession.current = undefined;
        current.lock();
        setSession(undefined);
        setPassword("");
        setForm({});
        setEditing(undefined);
      }
      if (invalidate && selectedProfileId.current === changedId)
        selectProfile("");
      refreshProfiles();
    }, localProfiles);
    return () => {
      active = false;
      stop();
    };
  }, []);
  useEffect(() => {
    const lock = () => {
      if (document.visibilityState === "hidden") {
        unlockEpoch.current++;
        activeSession.current?.lock();
        activeSession.current = undefined;
        setSession(undefined);
        setPassword("");
        setForm({});
        setEditing(undefined);
      }
    };
    document.addEventListener("visibilitychange", lock);
    return () => {
      document.removeEventListener("visibilitychange", lock);
      unlockEpoch.current++;
      activeSession.current?.lock();
      activeSession.current = undefined;
    };
  }, []);
  async function signIn(
    method: "passphrase" | "pin" | "biometric" = unlockMethod,
  ) {
    if (pendingSignIn.current) return;
    pendingSignIn.current = true;
    setBusy(true);
    setError(undefined);
    let next: LocalSession | undefined;
    try {
      const epoch = unlockEpoch.current;
      next = id
        ? method === "passphrase"
          ? await unlockLocalProfile(id, password, localProfiles)
          : await unlockLocalProfileWith(id, method, password, localProfiles)
        : await createLocalProfile(name, password, localProfiles);
      if (epoch !== unlockEpoch.current || next.locked) {
        next.lock();
        next = undefined;
        throw Error(
          "The profile changed or was locked. Unlock it again to continue.",
        );
      }
      activeSession.current?.lock();
      activeSession.current = next;
      setSession(next);
      next = undefined;
      setPassword("");
      setUnlockNotice("");
    } catch (e) {
      next?.lock();
      setError(e);
    } finally {
      pendingSignIn.current = false;
      setBusy(false);
    }
  }
  return (
    <main className="local-workspace">
      <header className="local-profile-header">
        <span className="wordmark">
          <BrandIcon size={28} />
          Common
        </span>
        <span className="small muted">Personal workspace</span>
      </header>
      <PageHeading
        title={session ? session.name : "Local profiles"}
        description="Standalone work saved on this device. Company data remains separate."
      />
      <ErrorMessage error={error} />
      {unlockNotice && <p role="status">{unlockNotice}</p>}
      {!session ? (
        <form
          className="form-stack local-profile-form"
          onSubmit={(e) => {
            e.preventDefault();
            void signIn();
          }}
        >
          <Field label="Profile">
            <Select
              value={id}
              onValueChange={(value) => {
                unlockEpoch.current++;
                setPassword("");
                selectProfile(value);
              }}
            >
              <SelectOption value="">Create a local profile</SelectOption>
              {profiles.map((p) => (
                <SelectOption key={p.id} value={p.id}>
                  {p.name}
                </SelectOption>
              ))}
            </Select>
          </Field>
          {!id && (
            <Field label="Profile name">
              <Input
                value={name}
                required
                maxLength={100}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
          )}
          <Field
            label={id && unlockMethod === "pin" ? "Profile PIN" : "Passphrase"}
          >
            <Input
              value={password}
              type="password"
              minLength={id && unlockMethod === "pin" ? 8 : 12}
              maxLength={id && unlockMethod === "pin" ? 12 : undefined}
              inputMode={id && unlockMethod === "pin" ? "numeric" : undefined}
              pattern={id && unlockMethod === "pin" ? "[0-9]{8,12}" : undefined}
              required
              autoComplete={
                id && unlockMethod === "pin"
                  ? "off"
                  : id
                    ? "current-password"
                    : "new-password"
              }
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <p>
            {id && unlockMethod === "pin"
              ? "Enter your PIN of 8 to 12 digits. Your passphrase remains available for recovery."
              : "Use at least 12 characters. Keep your passphrase to recover this local profile if quick unlock is lost."}
          </p>
          {id && unlockStatus?.enabled && (
            <div className="actions">
              <Button
                type="button"
                disabled={
                  busy ||
                  (unlockMethod === "passphrase" && !unlockStatus.available)
                }
                onClick={() => {
                  unlockEpoch.current++;
                  setPassword("");
                  setError(undefined);
                  setUnlockMethod((value) =>
                    value === "pin" ? "passphrase" : "pin",
                  );
                }}
              >
                {unlockMethod === "pin"
                  ? "Use passphrase instead"
                  : "Use PIN instead"}
              </Button>
              {unlockStatus.biometric && unlockStatus.biometricAvailable && (
                <Button
                  type="button"
                  disabled={busy || !unlockStatus.available}
                  onClick={() => void signIn("biometric")}
                >
                  Use Touch ID
                </Button>
              )}
            </div>
          )}
          <Button type="submit" variant="primary" disabled={busy}>
            {id ? "Unlock profile" : "Create profile"}
          </Button>
          {id && (
            <Button
              type="button"
              variant="danger"
              onClick={() => setRemoving(true)}
            >
              Remove profile
            </Button>
          )}
          <ProfileRecovery
            onRestore={(restored) => {
              if (restored.locked)
                throw Error(
                  "The profile was locked. Unlock it again to continue.",
                );
              unlockEpoch.current++;
              activeSession.current?.lock();
              activeSession.current = restored;
              setSession(restored);
              selectProfile(restored.id);
              setPassword("");
              setError(undefined);
            }}
          />
          <Button type="button" onClick={onExit}>
            Online workspaces
          </Button>
        </form>
      ) : (
        <>
          <div className="module-toolbar">
            <Field label="Module and resource">
              <Select value={key} onValueChange={setKey}>
                {resources.map((r) => (
                  <SelectOption key={r.key} value={r.key}>
                    {r.module.name}: {r.resource.title}
                  </SelectOption>
                ))}
              </Select>
            </Field>
            <Button
              variant="primary"
              disabled={!selected}
              onClick={() => {
                if (!selected) return;
                try {
                  setForm(
                    createSchemaDraft(selected.resource.schema) as Record<
                      string,
                      unknown
                    >,
                  );
                  setError(undefined);
                  setEditing(null);
                } catch (error) {
                  setError(error);
                }
              }}
            >
              New record
            </Button>
            <Button
              onClick={() => {
                activeSession.current = undefined;
                session.lock();
                setSession(undefined);
                setForm({});
                setEditing(undefined);
              }}
            >
              Lock profile
            </Button>
            <Button
              onClick={() => {
                const url = URL.createObjectURL(
                  new Blob([JSON.stringify(session.data, null, 2)], {
                    type: "application/json",
                  }),
                );
                const a = document.createElement("a");
                a.href = url;
                a.download = "local-workspace-export.json";
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              }}
            >
              Export data
            </Button>
            <LocalProfileUnlock
              id={session.id}
              onSaved={() => {
                selectProfile(session.id);
                setUnlockNotice(
                  "Quick unlock settings saved. Unlock your profile to continue.",
                );
              }}
            />
            <LocalModules
              session={session}
              registry={registry}
              changed={() => setRevision((r) => r + 1)}
              onlineWorkspaces={onExit}
            />
            <LocalActions
              key={session.id}
              session={session}
              changed={() => setRevision((r) => r + 1)}
            />
            <LocalDeviceRequests
              key={`devices-${session.id}`}
              session={session}
              changed={() => setRevision((r) => r + 1)}
            />
          </div>
          {!(selected ? (session.data.records[selected.key] ?? []) : []).some(
            (r) => !r.archived,
          ) && (
            <Empty
              title={
                selected
                  ? "No records yet"
                  : "No standalone resources installed"
              }
              description={
                selected
                  ? "Create your first record. Your work stays on this device."
                  : "Install a module with standalone resources to view its records. Retained records remain in this profile."
              }
            />
          )}
          {selected && (
            <>
              <div className="resource-query-controls">
                <TypedResourceRanges
                  key={rangeScope}
                  schema={selected.resource.schema as TObject}
                  value={ranges}
                  onChange={(next) => {
                    setRanges(next);
                    setCursor(undefined);
                    setPrevious([]);
                  }}
                />
                <TypedResourceSort
                  key={`sort/${rangeScope}`}
                  schema={selected.resource.schema as TObject}
                  value={orderBy}
                  onChange={(next) => {
                    setOrderBy([...next]);
                    setCursor(undefined);
                    setPrevious([]);
                  }}
                />
              </div>
              <ErrorMessage error={page.error} />
              {!!page.error && cursor && (
                <Button
                  onClick={() => {
                    setCursor(undefined);
                    setPrevious([]);
                  }}
                >
                  Return to first page
                </Button>
              )}
              <TypedResourceTable
                schema={selected.resource.schema as TObject}
                columns={selected.resource.columns}
                rows={page.items}
                label={`${selected.resource.title} records`}
                loadReferences={referenceLoader}
                renderActions={
                  selected.resource.appendOnly
                    ? undefined
                    : (row) => (
                        <Button
                          onClick={() => {
                            setEditing(row);
                            setForm(row.data);
                          }}
                        >
                          Edit
                        </Button>
                      )
                }
              />
              {Object.keys(ranges).length > 0 && (
                <p
                  role="status"
                  className={page.items.length ? "sr-only" : "muted"}
                >
                  {page.items.length
                    ? `${page.items.length} matching records on this page.`
                    : "No records match the current ranges."}
                </p>
              )}
              {(previous.length > 0 || page.nextCursor) && (
                <div className="actions">
                  <Button
                    variant="ghost"
                    disabled={!previous.length}
                    onClick={() => {
                      setCursor(previous.at(-1));
                      setPrevious(previous.slice(0, -1));
                    }}
                  >
                    Previous records
                  </Button>
                  <span>Page {previous.length + 1}</span>
                  <Button
                    variant="ghost"
                    disabled={!page.nextCursor}
                    onClick={() => {
                      setPrevious([...previous, cursor]);
                      setCursor(page.nextCursor ?? undefined);
                    }}
                  >
                    Next records
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      )}
      <Modal
        open={editing !== undefined}
        onOpenChange={(v) => {
          if (!v) setEditing(undefined);
        }}
        title="Local record"
        description="Saved only in this encrypted local profile."
      >
        <form
          className="form-stack"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!selected || !session) return;
            setBusy(true);
            try {
              const client = createModuleClient(selected.module, (call) =>
                session!.execute(selected.module, call),
              );
              const resource = client.resource(
                key.slice(selected.module.id.length + 1),
              );
              if (editing) await resource.update(editing.id, form, editing);
              else await resource.create(form);
              setEditing(undefined);
              setRevision(revision + 1);
            } catch (e) {
              setError(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          <SchemaForm
            schema={(selected?.resource.schema ?? {}) as FormSchema}
            fieldOrder={selected?.resource.columns}
            loadReferences={referenceLoader}
            value={form}
            onChange={setForm}
          />
          <ErrorMessage error={error} />
          <Button type="submit" variant="primary" disabled={busy}>
            Save locally
          </Button>
        </form>
      </Modal>
      <Modal
        open={removing}
        onOpenChange={setRemoving}
        title="Remove local profile"
        description="This removes the profile from your list and locks its open sessions. Encrypted records and unfinished work stay on this device. Restore it from Removed profiles using its original passphrase."
      >
        <Button
          variant="danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(undefined);
            try {
              await removeLocalProfile(id, localProfiles);
              setProfiles(await listLocalProfiles(localProfiles));
              selectProfile("");
              setPassword("");
              setRemoving(false);
            } catch (error) {
              setError(error);
            } finally {
              setBusy(false);
            }
          }}
        >
          Remove from this device’s profile list
        </Button>
      </Modal>
    </main>
  );
}
