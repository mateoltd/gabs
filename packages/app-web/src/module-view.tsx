import { useModuleReferences } from "./module-references";
import { canonical } from "@suite/module-sdk/registry";
import {
  TypedResourceTable,
  TypedResourceFilters,
  Select,
  SelectOption,
} from "@suite/ui-web";
import { createSchemaDraft } from "@suite/module-sdk/forms";
import { useEffect, useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  assertSchema,
  type ResourceRecord,
  type ResourcePage,
  type ModuleCall,
  type ModuleDefinition,
  type TObject,
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
  const [previous, setPrevious] = useState<(string | undefined)[]>([]);
  const [limit, setLimit] = useState(50);
  const [where, setWhere] = useState<Record<string, unknown>>({});
  const resetPage = () => {
    setCursor(undefined);
    setPrevious([]);
  };
  const [editing, setEditing] = useState<ResourceRecord | null | undefined>(),
    [form, setForm] = useState<Record<string, unknown>>({}),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false);
  const [storage, setStorage] = useState<ModuleStorage>();
  const {
    references: refs,
    loadReferences,
    error: referenceError,
  } = useModuleReferences(props, module, resource);
  useEffect(() => {
    if (referenceError) setError(referenceError);
  }, [referenceError]);
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
  const pageKey = canonical([
    moduleId,
    module.version,
    resource,
    search,
    cursor ?? null,
    archived,
    limit,
    where,
  ]);
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
      limit,
      where,
    ],
    enabled: online && allowed && resourceAvailable,
    queryFn: async () => {
      const result = (await send({
        moduleId,
        moduleVersion: module.version,
        resource,
        action: "list",
        input: { search, cursor, archived, limit, where },
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
  }, [scope.userId, scope.workspaceId, pageKey, online, query.dataUpdatedAt]);
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
  if (!allowed)
    return (
      <Empty
        title="Module access required"
        description="Ask your administrator for access to this module."
      />
    );
  const page = online
    ? query.data
    : (storage?.pages[pageKey] ??
      (limit === 50 && Object.keys(where).length === 0
        ? storage?.pages[
            `${moduleId}@${module.version}/${resource}/${search}/${cursor ?? ""}/${archived}`
          ]
        : undefined));
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
                setForm(
                  createSchemaDraft(definition.schema) as Record<
                    string,
                    unknown
                  >,
                );
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
          resetPage();
          setSearch("");
          setWhere({});
          setArchived(false);
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
              maxLength={100}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                resetPage();
              }}
            />
          </label>
          <Button
            aria-pressed={archived}
            onClick={() => {
              setArchived(!archived);
              resetPage();
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
        <TypedResourceFilters
          key={`${resource}@${module.version}`}
          schema={definition.schema as TObject}
          value={where}
          onChange={(next) => {
            setWhere(next);
            resetPage();
          }}
          references={refs}
          loadReferences={loadReferences}
        />
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
                ? search || Object.keys(where).length || archived || cursor
                  ? "No records match this page. Adjust the filters or return to the first page."
                  : "Create a record to get started."
                : "No matching records have been downloaded on this device."
            }
          />
        ) : (
          <TypedResourceTable
            schema={definition.schema as TObject}
            columns={definition.columns}
            rows={page.items}
            label={`${definition.title} records`}
            references={refs}
            loadReferences={loadReferences}
            renderActions={(row) =>
              write &&
              !archived &&
              !definition.appendOnly && (
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
              )
            }
          />
        )}
        <div
          className="module-toolbar resource-pagination"
          aria-label="Record pages"
        >
          <Button disabled={!cursor || query.isFetching} onClick={resetPage}>
            First page
          </Button>
          <Button
            disabled={!previous.length || query.isFetching}
            onClick={() => {
              setCursor(previous.at(-1));
              setPrevious(previous.slice(0, -1));
            }}
          >
            Previous page
          </Button>
          <span role="status">
            Page {previous.length + 1}. {page?.items.length ?? 0}{" "}
            {page?.items.length === 1 ? "record" : "records"}.
          </span>
          <Button
            disabled={!page?.nextCursor || query.isFetching}
            onClick={() => {
              setPrevious([...previous, cursor]);
              setCursor(page?.nextCursor ?? undefined);
            }}
          >
            Next page
          </Button>
          <Field label="Records per page">
            <Select
              value={String(limit)}
              onValueChange={(value) => {
                setLimit(Number(value));
                resetPage();
              }}
            >
              {[10, 25, 50, 100].map((size) => (
                <SelectOption key={size} value={String(size)}>
                  {size}
                </SelectOption>
              ))}
            </Select>
          </Field>
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
              validate={
                !!error &&
                typeof error === "object" &&
                "code" in error &&
                error.code === "INVALID_INPUT"
              }
              fieldOrder={definition.columns}
              value={form}
              referenceOptions={refs}
              loadReferences={loadReferences}
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
