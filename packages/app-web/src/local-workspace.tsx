import { Table } from "@suite/ui-web";
import { useEffect, useState } from "react";
import { moduleDefinitions } from "@suite/module-catalog";
import { assertSchema, type ResourceRecord } from "@suite/module-sdk";
import {
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
export function LocalWorkspace({ onExit }: { onExit: () => void }) {
  const [profiles, setProfiles] = useState<{ id: string; name: string }[]>([]),
    [id, setId] = useState(""),
    [name, setName] = useState(""),
    [password, setPassword] = useState(""),
    [session, setSession] = useState<LocalSession>(),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false),
    [removing, setRemoving] = useState(false);
  const resources = moduleDefinitions.flatMap((m) =>
    Object.entries(m.resources)
      .sort(([a], [b]) =>
        a === m.id ? -1 : b === m.id ? 1 : a.localeCompare(b),
      )
      .filter(([, r]) => r.standalone)
      .map(([id, r]) => ({ key: `${m.id}/${id}`, module: m, resource: r })),
  );
  const [key, setKey] = useState(resources[0]?.key ?? ""),
    [form, setForm] = useState<Record<string, unknown>>({}),
    [editing, setEditing] = useState<ResourceRecord | null | undefined>(),
    [revision, setRevision] = useState(0);
  const selected = resources.find((r) => r.key === key)!;
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
    return () => document.removeEventListener("visibilitychange", lock);
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
              onClick={() => {
                setEditing(null);
                setForm({});
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
          </div>
          {!(session.data.records[key] ?? []).some((r) => !r.archived) && (
            <Empty
              title="No records yet"
              description="Create your first record. Your work stays on this device."
            />
          )}
          <div className="table-scroll">
            <Table className="module-table">
              <thead>
                <tr>
                  {selected.resource.columns.map((c) => (
                    <th key={c}>
                      {selected.resource.schema.properties[c]?.title ??
                        fieldLabel(c)}
                    </th>
                  ))}
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {(session.data.records[key] ?? [])
                  .filter((r) => !r.archived)
                  .map((r) => (
                    <tr key={r.id}>
                      {selected.resource.columns.map((c) => (
                        <td key={c}>{String(r.data[c] ?? "")}</td>
                      ))}
                      <td>
                        {!selected.resource.appendOnly && (
                          <Button
                            onClick={() => {
                              setEditing(r);
                              setForm(r.data);
                            }}
                          >
                            Edit
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </Table>
          </div>
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
            setBusy(true);
            try {
              assertSchema(selected.resource.schema, form);
              const record: ResourceRecord = {
                id: editing?.id ?? crypto.randomUUID(),
                data: form,
                version: (editing?.version ?? 0) + 1,
                archived: false,
                updatedAt: new Date().toISOString(),
              };
              await session!.save({
                records: {
                  ...session!.data.records,
                  [key]: [
                    ...(session!.data.records[key] ?? []).filter(
                      (r) => r.id !== record.id,
                    ),
                    record,
                  ],
                },
              });
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
            schema={selected.resource.schema as FormSchema}
            fieldOrder={selected.resource.columns}
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
