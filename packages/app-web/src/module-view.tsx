import { Table } from "@suite/ui-web";
import { useEffect, useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  assertSchema,
  type ResourceRecord,
  type ResourcePage,
  type ModuleCall,
  type ModuleDefinition,
  type TSchema,
} from "@suite/module-sdk";
import { canUse, type FeatureProps } from "@suite/platform";
import { ModuleInputRecoverySchema } from "@suite/module-sdk/platform";
import {
  changeModuleStorage,
  enqueue,
  readModuleStorage,
  syncModuleStorage,
  type ModuleStorage,
} from "@suite/platform/module-storage";
import {
  PageHeading,
  SegmentedControl,
  Button,
  Field,
  Input,
  Modal,
  ErrorMessage,
  Empty,
  Loading,
  SchemaForm,
  type FormSchema,
  fieldLabel,
} from "@suite/ui-web";
import { Plus, Search } from "@suite/ui-web/icons";
export function ModuleView(props: FeatureProps & { module: ModuleDefinition }) {
  const { client, scope, bootstrap, online, platform, module } = props;
  const moduleId = module.id;
  const qc = useQueryClient();
  const names = Object.keys(module.resources).sort((a, b) =>
    a === module.id ? -1 : b === module.id ? 1 : a.localeCompare(b),
  );
  const [resource, setResource] = useState(names[0]);
  const retainedDefinitions = useRef({ ...module.resources });
  Object.assign(retainedDefinitions.current, module.resources);
  const definition =
    module.resources[resource] ?? retainedDefinitions.current[resource];
  const resourceAvailable = !!module.resources[resource];
  const [reviewId, setReviewId] = useState<string>();
  const [reviewTargetId, setReviewTargetId] = useState<string>();
  const attempt = useRef<ModuleCall | undefined>(undefined);
  const [search, setSearch] = useState(""),
    [cursor, setCursor] = useState<string>(),
    [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState<ResourceRecord | null | undefined>(),
    [form, setForm] = useState<Record<string, unknown>>({}),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false);
  const [storage, setStorage] = useState<ModuleStorage>(),
    [refs, setRefs] = useState<
      Record<string, { value: string; label: string }[]>
    >({});
  const [editingVersion, setEditingVersion] = useState(module.version);
  const [carriedInput, setCarriedInput] = useState<{
    version: string;
    resource: string;
    data: Record<string, unknown>;
    record: ResourceRecord | null;
  }>();
  if (editingVersion !== module.version) {
    if (editing !== undefined)
      setCarriedInput({
        version: editingVersion,
        resource,
        data: structuredClone(form),
        record: editing,
      });
    setEditingVersion(module.version);
  }
  useEffect(() => {
    if (editing === undefined) {
      setCarriedInput(undefined);
      if (!resourceAvailable && names.length) setResource(names[0]);
    }
  }, [editing, resourceAvailable, module.version]);
  const obsoleteFields = Object.keys(form).filter(
    (key) => !(key in definition.schema.properties),
  );
  const exportInput = async () => {
    try {
      const input = carriedInput ?? {
        version: module.version,
        resource,
        data: form,
        record: editing ?? null,
      };
      const recovery = {
        kind: "module-input-recovery",
        userId: scope.userId,
        workspaceId: scope.workspaceId,
        moduleId,
        moduleVersion: input.version,
        resource: input.resource,
        input: {
          data: input.data,
          ...(input.record
            ? { id: input.record.id, baseVersion: input.record.version }
            : {}),
        },
        ...(attempt.current
          ? { status: "unconfirmed", pendingRequest: attempt.current }
          : { status: "unsaved" }),
      };
      assertSchema(ModuleInputRecoverySchema, recovery);
      await platform.saveFile(
        `module-input-${crypto.randomUUID()}.json`,
        JSON.stringify(recovery, null, 2),
      );
    } catch (error) {
      setError(error);
    }
  };
  const pageKey = `${moduleId}@${module.version}/${resource}/${search}/${cursor ?? ""}/${archived}`;
  const draftKey = `${moduleId}/${resource}`;
  const allowed = canUse(bootstrap, moduleId, `${moduleId}.${resource}.read`);
  const write = canUse(bootstrap, moduleId, `${moduleId}.${resource}.write`);
  const authorized = () =>
    navigator.onLine &&
    Date.now() <
      new Date(bootstrap.authorizedAt).getTime() +
        Math.max(bootstrap.offlineHours, 1 / 60) * 3600000;
  const send = (call: ModuleCall) =>
    client.request({
      operation: "moduleRequest",
      params: { workspaceId: scope.workspaceId, moduleId: call.moduleId },
      body: { action: call.action, resource: call.resource, input: call.input },
      idempotencyKey: call.key,
      moduleVersion: call.moduleVersion,
    });
  const read = async () => {
    const s = await readModuleStorage(platform, scope);
    setStorage(s);
    return s;
  };
  const query = useQuery({
    queryKey: [
      scope.userId,
      scope.workspaceId,
      moduleId,
      module.version,
      resource,
      search,
      cursor,
      archived,
    ],
    enabled: online && allowed && resourceAvailable,
    queryFn: async () => {
      const result = (await send({
        moduleId,
        moduleVersion: module.version,
        resource,
        action: "list",
        input: { search, cursor, archived },
      })) as ResourcePage;
      if (props.offlineEnabled && bootstrap.offlineHours > 0)
        await changeModuleStorage(platform, scope, (s) => {
          s.pages[pageKey] = result;
        });
      return result;
    },
  });
  useEffect(() => {
    let active = true;
    readModuleStorage(platform, scope)
      .then((s) => {
        if (active) setStorage(s);
      })
      .catch(setError);
    return () => {
      active = false;
    };
  }, [scope.userId, scope.workspaceId, pageKey]);
  useEffect(() => {
    if (!online || !allowed || !resourceAvailable) return;
    let active = true;
    const sync = async () => {
      try {
        await syncModuleStorage(platform, scope, send, authorized);
        if (active) {
          await read();
          await qc.invalidateQueries({
            queryKey: [scope.userId, scope.workspaceId, moduleId],
          });
        }
      } catch (e) {
        if (active) setError(e);
      }
    };
    void sync();
    const timer = setInterval(sync, 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [online, allowed, bootstrap.authorizedAt, moduleId]);
  useEffect(() => {
    let active = true;
    const referenceKey = `${moduleId}@${module.version}/${resource}`;
    setRefs({});
    const load = async () => {
      if (!online) {
        const stored = await readModuleStorage(platform, scope);
        if (active) setRefs(stored.referenceOptions?.[referenceKey] ?? {});
        return;
      }
      const values: typeof refs = {};
      let providers: { id: string; version: string }[] | undefined;
      for (const [key, schema] of Object.entries(
        definition.schema.properties as Record<string, TSchema>,
      )) {
        if (schema["x-membership"]) {
          values[key] = [];
          let cursor: string | null = null;
          do {
            if (!active) return;
            const directory: import("@suite/module-sdk").MemberPage =
              await client.request({
                operation: "moduleMembers",
                moduleVersion: module.version,
                params: {
                  workspaceId: scope.workspaceId,
                  moduleId,
                  resource,
                  field: key,
                },
                query: cursor ? { cursor } : {},
              });
            values[key].push(
              ...directory.items.map((m) => ({ value: m.id, label: m.name })),
            );
            cursor = directory.nextCursor;
          } while (cursor);
          continue;
        }
        const ref = schema["x-reference"] as
          { module: string; resource: string } | undefined;
        if (!ref) continue;
        try {
          // Same-module references use the installed contract. Other providers
          // use this workspace's selected contract, never a global catalog entry.
          if (ref.module !== moduleId && !providers)
            providers = (
              await client.request({
                operation: "platformState",
                params: { workspaceId: scope.workspaceId },
              })
            ).modules;
          const version =
            ref.module === moduleId
              ? module.version
              : providers?.find((provider) => provider.id === ref.module)
                  ?.version;
          if (!version) throw Error("The referenced module is unavailable.");
          const page = (await send({
            moduleId: ref.module,
            moduleVersion: version,
            resource: ref.resource,
            action: "list",
            input: { limit: 100 },
          })) as ResourcePage;
          values[key] = page.items.map((r) => ({
            value: r.id,
            label: String(r.data.name ?? r.data.title ?? r.id),
          }));
        } catch {
          /* Server still validates references and grants on save. */
        }
      }
      if (active) {
        setRefs(values);
        if (props.offlineEnabled)
          await changeModuleStorage(platform, scope, (s) => {
            if (active) (s.referenceOptions ??= {})[referenceKey] = values;
          });
      }
    };
    void load().catch((error) => {
      if (active) setError(error);
    });
    return () => {
      active = false;
    };
  }, [resource, editing !== undefined, online, module.version]);
  if (!allowed)
    return (
      <Empty
        title="Module access required"
        description="Ask your administrator for access to this module."
      />
    );
  const page = online ? query.data : storage?.pages[pageKey];
  const pending =
    storage?.journal.filter(
      (e) =>
        e.call.moduleId === moduleId &&
        e.call.resource === resource &&
        e.state !== "accepted" &&
        !e.supersededBy,
    ) ?? [];
  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      if (!attempt.current) {
        if (!resourceAvailable)
          throw Error(
            "This resource was removed in the current release. Export your input before closing the editor.",
          );
        assertSchema(definition.schema, form);
      }
      const call: ModuleCall = attempt.current ?? {
        moduleId,
        moduleVersion: module.version,
        resource,
        action: editing ? "update" : "create",
        input: editing
          ? { id: editing.id, data: form, baseVersion: editing.version }
          : { id: reviewTargetId ?? crypto.randomUUID(), data: form },
        key: crypto.randomUUID(),
      };
      if (
        definition.policy === "online" ||
        !props.offlineEnabled ||
        !bootstrap.offlineHours
      ) {
        if (!online) throw Error("Connect to save this change.");
        attempt.current = call;
        await send(call);
        attempt.current = undefined;
        setEditing(undefined);
      } else {
        if (!online && !props.offlineEnabled)
          throw Error(
            "Enable offline storage while connected before saving offline.",
          );
        attempt.current = call;
        await enqueue(platform, scope, call, [], {
          draftKey,
          supersedes: reviewId,
        });
        attempt.current = undefined;
        setEditing(undefined);
        setReviewId(undefined);
        setReviewTargetId(undefined);
        if (online) await syncModuleStorage(platform, scope, send, authorized);
      }
      if (props.offlineEnabled && bootstrap.offlineHours > 0)
        await changeModuleStorage(platform, scope, (s) => {
          delete s.drafts[draftKey];
          if (s.draftTargets) delete s.draftTargets[draftKey];
          if (reviewId) {
            s.journal = s.journal.map((e) =>
              e.id === reviewId
                ? { ...e, supersededBy: call.key }
                : {
                    ...e,
                    dependencies: e.dependencies.map((id) =>
                      id === reviewId ? call.key! : id,
                    ),
                  },
            );
          }
        });
      setReviewId(undefined);
      setReviewTargetId(undefined);
      await read();
      if (online) await query.refetch();
      setEditing(undefined);
    } catch (e) {
      if (
        (e as { status?: number }).status &&
        (e as { status: number }).status < 500
      )
        attempt.current = undefined;
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        title={module.name}
        description={module.description}
        actions={
          write && (
            <Button
              variant="primary"
              disabled={!resourceAvailable}
              onClick={() => {
                setForm({});
                setReviewId(undefined);
                setReviewTargetId(undefined);
                setEditing(null);
              }}
            >
              <Plus size={16} />
              New {definition.title.toLowerCase()}
            </Button>
          )
        }
      />
      <SegmentedControl
        panelId="module-resource-content"
        label={`${module.name} resources`}
        value={resource}
        options={names.map((name) => ({
          value: name,
          label: module.resources[name].title,
        }))}
        onChange={(name) => {
          setResource(name);
          setCursor(undefined);
          setSearch("");
        }}
      />
      <section
        id="module-resource-content"
        role="tabpanel"
        aria-label={definition.title}
        className="module-resource-content"
      >
        <div className="module-toolbar resource-toolbar">
          <label className="search-field">
            <Search size={17} />
            <span className="sr-only">Search</span>
            <Input
              placeholder={`Search ${definition.title.toLowerCase()}`}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCursor(undefined);
              }}
            />
          </label>
          <Button
            aria-pressed={archived}
            onClick={() => {
              setArchived(!archived);
              setCursor(undefined);
            }}
          >
            {archived ? "Show active" : "Show archived"}
          </Button>
          {write && storage?.drafts[draftKey] && (
            <Button
              onClick={() => {
                setForm(storage.drafts[draftKey]);
                setEditing(storage.draftTargets?.[draftKey] ?? null);
                setReviewId(undefined);
                setReviewTargetId(undefined);
              }}
            >
              Resume saved draft
            </Button>
          )}
        </div>
        {!online && (
          <p role="status">
            Offline copy. Changes remain pending until the server accepts them.
          </p>
        )}
        <ErrorMessage error={error ?? query.error} />
        {query.isLoading ? (
          <Loading />
        ) : !page?.items.length ? (
          <Empty
            title="No records"
            description={
              online
                ? "Create a record to get started."
                : "No matching records have been downloaded on this device."
            }
          />
        ) : (
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label={`${definition.title} records`}
          >
            <Table className="module-table">
              <thead>
                <tr>
                  {definition.columns.map((c) => (
                    <th key={c}>
                      {definition.schema.properties[c]?.title ?? fieldLabel(c)}
                    </th>
                  ))}
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((row) => (
                  <tr key={row.id}>
                    {definition.columns.map((c) => (
                      <td key={c}>
                        {refs[c]?.find((r) => r.value === row.data[c])?.label ??
                          (definition.schema.properties[c]?.anyOf ||
                          definition.schema.properties[c]?.enum
                            ? fieldLabel(String(row.data[c] ?? ""))
                            : String(row.data[c] ?? ""))}
                      </td>
                    ))}
                    <td>
                      {write && !archived && !definition.appendOnly && (
                        <div className="actions">
                          <Button
                            variant="ghost"
                            onClick={() => {
                              setEditing(row);
                              setForm(row.data);
                            }}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={!online || busy}
                            onClick={async () => {
                              setBusy(true);
                              try {
                                await send({
                                  moduleId,
                                  moduleVersion: module.version,
                                  resource,
                                  action: "archive",
                                  input: {
                                    id: row.id,
                                    baseVersion: row.version,
                                  },
                                  key: crypto.randomUUID(),
                                });
                                await query.refetch();
                              } catch (e) {
                                setError(e);
                              } finally {
                                setBusy(false);
                              }
                            }}
                          >
                            Archive
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
        <div className="module-toolbar resource-pagination">
          <Button disabled={!cursor} onClick={() => setCursor(undefined)}>
            First page
          </Button>
          <Button
            disabled={!page?.nextCursor}
            onClick={() => setCursor(page?.nextCursor ?? undefined)}
          >
            Next page
          </Button>
        </div>
        {!!pending.length && (
          <section className="panel">
            <h2>Pending changes</h2>
            {pending.map((entry) => (
              <div className="module-pending" key={entry.id}>
                <strong>{entry.state}</strong>
                <span>{entry.error ?? "Waiting for server acceptance"}</span>
                <Button
                  disabled={!online || entry.state === "pending"}
                  onClick={async () => {
                    const command = entry.call.input as {
                      id?: string;
                      data?: Record<string, unknown>;
                    };
                    try {
                      const current =
                        entry.call.action === "update"
                          ? ((await send({
                              moduleId,
                              moduleVersion: module.version,
                              resource,
                              action: "get",
                              input: { id: command.id },
                            })) as ResourceRecord)
                          : null;
                      if (current?.archived)
                        throw Error(
                          "This record has been archived. Export the pending change to recover its contents.",
                        );
                      setForm(command.data ?? {});
                      setEditing(current);
                      setReviewId(entry.id);
                      setReviewTargetId(command.id);
                    } catch (e) {
                      setError(e);
                    }
                  }}
                >
                  Review
                </Button>
              </div>
            ))}
          </section>
        )}
      </section>
      <Modal
        open={editing !== undefined}
        onOpenChange={(open) => {
          if (!open && !attempt.current) {
            setEditing(undefined);
            setReviewId(undefined);
            setReviewTargetId(undefined);
            void read();
          }
        }}
        title={editing ? "Edit record" : "New record"}
        description={
          resourceAvailable
            ? `Save ${definition.title.toLowerCase()} in this workspace.`
            : "Recover input from a removed resource."
        }
      >
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          {carriedInput && (
            <section className="form-stack" aria-label="Preserved input">
              <p role="status">
                Updated to {module.version}. Your input is preserved.
              </p>
              <details>
                <summary>Input before update</summary>
                <pre
                  style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                >
                  {JSON.stringify(carriedInput.data, null, 2)}
                </pre>
              </details>
              <Button type="button" onClick={() => void exportInput()}>
                Export input before update
              </Button>
            </section>
          )}
          {!resourceAvailable && (
            <p role="alert">
              This release removed {definition.title.toLowerCase()}. Your input
              remains here, but cannot be saved to the removed resource. Export
              it before closing.
            </p>
          )}
          {!!obsoleteFields.length && (
            <section
              className="form-stack"
              aria-label="Fields removed by update"
            >
              <h3>Fields removed by update</h3>
              <p>
                These values are retained. Remove each obsolete field explicitly
                to save with the current schema.
              </p>
              {obsoleteFields.map((key) => (
                <div key={key} className="form-stack">
                  <span>
                    {fieldLabel(key)}: {JSON.stringify(form[key])}
                  </span>
                  <Button
                    type="button"
                    disabled={!!attempt.current}
                    onClick={() =>
                      setForm(({ [key]: _removed, ...rest }) => rest)
                    }
                  >
                    Remove {fieldLabel(key)} from this edit
                  </Button>
                </div>
              ))}
            </section>
          )}
          <fieldset
            disabled={!!attempt.current}
            className="module-form-fields form-stack"
          >
            <SchemaForm
              schema={definition.schema as FormSchema}
              fieldOrder={definition.columns}
              value={form}
              referenceOptions={refs}
              onChange={(v) => {
                setForm(v);
                if (props.offlineEnabled && bootstrap.offlineHours)
                  void changeModuleStorage(platform, scope, (s) => {
                    s.drafts[draftKey] = v;
                    (s.draftTargets ??= {})[draftKey] = editing ?? null;
                  }).catch(setError);
              }}
            />
          </fieldset>
          {attempt.current && (
            <p role="status">
              The server response is uncertain. Retry this same change before
              editing or closing it.
            </p>
          )}
          <ErrorMessage error={error} />
          <Button
            type="submit"
            variant="primary"
            disabled={busy || (!resourceAvailable && !attempt.current)}
          >
            {online ? "Save" : "Save pending change"}
          </Button>
        </form>
      </Modal>
    </>
  );
}
