import { createSchemaDraft } from "@suite/module-sdk/forms";
import { LocalActions } from "./local-actions";
import { LocalModules, type LocalRegistry } from "./local-modules";
import { TypedResourceTable } from "@suite/ui-web";
import { listResourceRecords } from "../../module-sdk/src/resource-query";
import { useEffect, useState, useMemo } from "react";
import {
  createModuleClient,
  type ResourceRecord,
  type TObject,
} from "@suite/module-sdk";
import {
  availableLocalModules,
  listLocalProfiles,
  createLocalProfile,
  unlockLocalProfile,
  removeLocalProfile,
  type LocalSession,
} from "@suite/platform/local-profiles";
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
import { BrandIcon } from "./brand";
export function LocalWorkspace({
  onExit,
  registry,
}: {
  onExit: () => void;
  registry?: LocalRegistry;
}) {
  const [profiles, setProfiles] = useState<{ id: string; name: string }[]>([]),
    [id, setId] = useState(""),
    [name, setName] = useState(""),
    [password, setPassword] = useState(""),
    [session, setSession] = useState<LocalSession>(),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [removing, setRemoving] = useState(false);
  const [revision, setRevision] = useState(0);
  const resources = useMemo(
    () =>
      availableLocalModules(session?.data ?? { records: {} }).flatMap((m) =>
        Object.entries(m.resources)
          .sort(([a], [b]) =>
            a === m.id ? -1 : b === m.id ? 1 : a.localeCompare(b),
          )
          .filter(([, r]) => r.standalone)
          .map(([id, r]) => ({ key: `${m.id}/${id}`, module: m, resource: r })),
      ),
    [session, revision],
  );
  const [key, setKey] = useState(resources[0]?.key ?? ""),
    [form, setForm] = useState<Record<string, unknown>>({}),
    [editing, setEditing] = useState<ResourceRecord | null | undefined>();
  const selected = resources.find((r) => r.key === key) ?? resources[0];
  const [cursor, setCursor] = useState<string>();
  const [previous, setPrevious] = useState<(string | undefined)[]>([]);
  useEffect(() => {
    setCursor(undefined);
    setPrevious([]);
  }, [selected?.key, session?.id]);
  const page = useMemo(
    () =>
      selected && session
        ? listResourceRecords(
            selected.resource.schema,
            session.data.records[selected.key] ?? [],
            { limit: 50, cursor },
          )
        : { items: [], nextCursor: null, total: 0 },
    [selected, session, revision, cursor],
  );
  const referenceLoader = useMemo(() => {
    if (!selected || !session) return undefined;
    return createModuleClient(selected.module, (call, options) =>
      session.execute(selected.module, call, options),
    ).resource(selected.key.slice(selected.module.id.length + 1))
      .loadReferences;
  }, [selected?.module, selected?.key, session]);
  useEffect(() => {
    if (selected && selected.key !== key) {
      setKey(selected.key);
      setEditing(undefined);
      setForm({});
    }
  }, [selected?.key, key]);
  useEffect(() => {
    void listLocalProfiles().then(setProfiles).catch(setError);
  }, []);
  useEffect(() => {
    const lock = () => {
      if (document.visibilityState === "hidden" && session) {
        session.lock();
        setSession(undefined);
        setPassword("");
        setForm({});
        setEditing(undefined);
      }
    };
    document.addEventListener("visibilitychange", lock);
    return () => {
      document.removeEventListener("visibilitychange", lock);
      session?.lock();
    };
  }, [session]);
  async function signIn() {
    setBusy(true);
    setError(undefined);
    try {
      setSession(
        id
          ? await unlockLocalProfile(id, password)
          : await createLocalProfile(name, password),
      );
      setPassword("");
      setProfiles(await listLocalProfiles());
    } catch (e) {
      setError(e);
    } finally {
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
      {!session ? (
        <form
          className="form-stack local-profile-form"
          onSubmit={(e) => {
            e.preventDefault();
            void signIn();
          }}
        >
          <Field label="Profile">
            <Select value={id} onValueChange={setId}>
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
          <Field label="Passphrase">
            <Input
              value={password}
              type="password"
              minLength={12}
              required
              autoComplete={id ? "current-password" : "new-password"}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <p>
            Use at least 12 characters. Losing the passphrase means losing
            access to this local profile.
          </p>
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
        description="This permanently removes this profile and all its local records. Export important data first."
      >
        <Button
          variant="danger"
          onClick={async () => {
            await removeLocalProfile(id);
            setProfiles(await listLocalProfiles());
            setId("");
            setRemoving(false);
          }}
        >
          Permanently remove profile
        </Button>
      </Modal>
    </main>
  );
}
