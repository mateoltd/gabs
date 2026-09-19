import { SavedCommands, useQueuedCommands } from "./queued-commands";
import {
  prepareContinuation,
  canContinue,
  continuationKey,
  type ContinuationAccess,
} from "../recovery/continuation";
import { replaceArchive } from "@suite/client/archive-recovery";
import { ArchiveReview } from "./archive-review";
import { CreateRecoveryNotice } from "./create-recovery-notice";
import { synchronizeWorkspace } from "../synchronization/host";
import { sendModuleCall } from "@suite/client/module-transport";
import { exportRecoveryInput } from "@suite/client/browser";
import { isDefinitiveRejection } from "@suite/module-sdk/sync";
import {
  settleJournalEntry,
  settleModuleCall,
  replaceFailedCreate,
  sameRecordCreateDependents,
  createCommandDependents,
  collisionDrafts,
  type CollisionDraft,
  type CreateDraftChoices,
  type CreateRecoveryTargets,
  type SettlementTransport,
} from "@suite/client/module-settlement";
import {
  validateModuleResponse,
  ResponseContractUnavailable,
} from "@suite/client/module-response";
import { resourceCursorCacheKey } from "@suite/module-sdk/queries";
import type { ResourceRangeBounds, ResourceSort } from "@suite/module-sdk";
import { ConflictReview } from "./conflict-review";
import { SavedChange, SavedDraft } from "./saved-change";
import { ArchivedInput } from "./archived-input";
import { useModuleReferences } from "./references";
import { canonical } from "@suite/module-sdk/registry";
import {
  TypedResourceTable,
  TypedResourceFilters,
  TypedResourceRanges,
  TypedResourceSort,
  Select,
  SelectOption,
} from "@suite/ui-web";
import { createSchemaDraft } from "@suite/module-sdk/forms";
import { useEffect, useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Type,
  assertSchema,
  reviewFields,
  chooseReviewField,
  unresolvedReviewFields,
  type ResourceRecord,
  type ResourcePage,
  type ModuleCall,
  type ModuleDefinition,
  type TObject,
} from "@suite/module-sdk";
import { canUse, type FeatureProps } from "@suite/client";
import { ModuleInputRecoverySchema } from "@suite/module-sdk/platform";
import {
  changeModuleStorage,
  cacheResourcePage,
  resourcePageDownloadedAt,
  saveResourceDraft,
  resourceDraftKey,
  removeResourceDraft,
  enqueue,
  readModuleStorage,
  recordDependencies,
  type ModuleStorage,
} from "@suite/client/module-storage";
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
  ResourceValue,
  type FormSchema,
  fieldLabel,
} from "@suite/ui-web";
import { Plus, Search } from "@suite/ui-web/icons";
export function ModuleView(props: FeatureProps & { module: ModuleDefinition }) {
  const recoveryContext = useRef(props);
  recoveryContext.current = props;
  const mounted = useRef(true);
  const recoveryExport = useRef(new AbortController());
  useEffect(() => {
    const controller = new AbortController();
    recoveryExport.current = controller;
    return () => controller.abort();
  }, [
    props.scope.userId,
    props.scope.workspaceId,
    props.module.id,
    props.module.version,
  ]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const { client, scope, bootstrap, online, platform, module, moduleCatalog } =
    props;
  const moduleId = module.id;
  const responseModules = useRef(new Map<string, ModuleDefinition>());
  responseModules.current.set(`${module.id}@${module.version}`, module);
  const [settling, setSettling] = useState<
    { type: "journal"; id: string } | { type: "edit" | "archive" }
  >();
  const [archiveAttempt, setArchiveAttempt] = useState<ModuleCall>();
  const [archiveNotice, setArchiveNotice] = useState<string>();
  const [archiveReviewId, setArchiveReviewId] = useState<string>();
  const qc = useQueryClient();
  const names = Object.keys(module.resources).sort((a, b) =>
    a === module.id ? -1 : b === module.id ? 1 : a.localeCompare(b),
  );
  const [resource, setResource] = useState(names[0]);
  const queued = useQueuedCommands(props, module, {
    kind: "view",
    permission:
      module.navigation?.permission ?? `${module.id}.${resource}.read`,
  });
  const retainedDefinitions = useRef({ ...module.resources });
  Object.assign(retainedDefinitions.current, module.resources);
  const definition =
    module.resources[resource] ?? retainedDefinitions.current[resource];
  const resourceAvailable = !!module.resources[resource];
  const [reviewSession, setReviewSession] =
    useState<NonNullable<ModuleStorage["draftReviews"]>[string]>();
  const reviewId = reviewSession?.entryId;
  const unresolved = reviewSession?.comparison
    ? unresolvedReviewFields(reviewSession.comparison)
    : [];
  const [reviewTargetId, setReviewTargetId] = useState<string>();
  const [separateCreate, setSeparateCreate] = useState(false);
  const [recoveryDrafts, setRecoveryDrafts] = useState<CollisionDraft[]>([]);
  const [draftChoices, setDraftChoices] = useState<CreateDraftChoices>({});
  const [checkingDrafts, setCheckingDrafts] = useState(false);
  const [draftScanError, setDraftScanError] = useState<unknown>();
  const draftGeneration = useRef<{ key: string; value: number } | undefined>(
    undefined,
  );
  const [recoveryTargets, setRecoveryTargets] = useState<CreateRecoveryTargets>(
    {},
  );
  const [directCreate, setDirectCreate] = useState<{
    call: ModuleCall;
    collision: boolean;
    cancelled: boolean;
  }>();
  const attempt = useRef<ModuleCall | undefined>(undefined);
  const attemptMode = useRef<"direct" | "journal">("direct");
  const requiresConnection =
    !!directCreate ||
    definition.policy === "online" ||
    (!!attempt.current && attemptMode.current === "direct") ||
    !props.offlineEnabled ||
    bootstrap.offlineHours <= 0;
  const [search, setSearch] = useState(""),
    [cursor, setCursor] = useState<string>(),
    [archived, setArchived] = useState(false);
  const [previous, setPrevious] = useState<(string | undefined)[]>([]);
  const [limit, setLimit] = useState(50);
  const [where, setWhere] = useState<Record<string, unknown>>({});
  const [ranges, setRanges] = useState<Record<string, ResourceRangeBounds>>({});
  const [orderBy, setOrderBy] = useState<ResourceSort[]>([]);
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
      const current = recoveryContext.current;
      if (
        !mounted.current ||
        current.scope.userId !== scope.userId ||
        current.scope.workspaceId !== scope.workspaceId ||
        !canUse(
          current.bootstrap,
          moduleId,
          `${moduleId}.${resource}.read`,
          current.moduleCatalog,
        )
      )
        throw Error("Current access does not allow exporting this input.");
      const input = carriedInput ?? {
        version: reviewSession?.recoveryInput?.moduleVersion ?? module.version,
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
            ? {
                id: reviewSession?.recoveryInput?.recordId ?? input.record.id,
                baseVersion:
                  reviewSession?.recoveryInput?.baseVersion ??
                  input.record.version,
              }
            : {}),
        },
        ...(attempt.current
          ? { status: "unconfirmed", pendingRequest: attempt.current }
          : { status: "unsaved" }),
      };
      assertSchema(ModuleInputRecoverySchema, recovery);
      await exportRecoveryInput({
        client,
        input: recovery,
        receivePolicy: (policy, signal) =>
          recoveryContext.current.receivePolicy(policy, signal),
        onError: (error) => recoveryContext.current.onError(error),
        signal: recoveryExport.current.signal,
        access: () => {
          const current = recoveryContext.current;
          return {
            policy: current.bootstrap,
            dependencies: current.moduleCatalog.dependencies(moduleId),
            online: current.online,
            offlineEnabled: current.offlineEnabled,
          };
        },
        check: () => {
          const current = recoveryContext.current;
          if (
            !mounted.current ||
            current.scope.userId !== recovery.userId ||
            current.scope.workspaceId !== recovery.workspaceId ||
            !canUse(
              current.bootstrap,
              recovery.moduleId,
              `${recovery.moduleId}.${recovery.resource}.read`,
              current.moduleCatalog,
            )
          )
            throw Error("Current access does not allow exporting this input.");
        },
      });
    } catch (error) {
      setError(error);
    }
  };
  const pageKey = canonical([
    moduleId,
    module.version,
    resource,
    search,
    resourceCursorCacheKey(cursor),
    archived,
    limit,
    where,
    ...(Object.keys(ranges).length ? [ranges] : []),
    ...(orderBy.length ? [{ sort: orderBy }] : []),
  ]);
  const ordinaryDraftKey = resourceDraftKey(moduleId, resource);
  const draftKey = resourceDraftKey(moduleId, resource, reviewSession);
  const reviewedCreate = storage?.journal.find(
    (entry) =>
      entry.id === reviewId &&
      entry.userId === scope.userId &&
      entry.workspaceId === scope.workspaceId &&
      entry.call.action === "create" &&
      !entry.supersededBy &&
      ["conflict", "rejected"].includes(entry.state),
  );
  const archiveReview = storage?.journal.find(
    (entry) => entry.id === archiveReviewId && !entry.supersededBy,
  );
  const recoveryEdits =
    storage && reviewedCreate
      ? sameRecordCreateDependents(storage, scope, reviewedCreate.id)
      : [];
  const identityCollision =
    reviewedCreate?.errorCode === "RECORD_EXISTS" || !!directCreate?.collision;
  const allowed = canUse(
    bootstrap,
    moduleId,
    `${moduleId}.${resource}.read`,
    moduleCatalog,
  );
  const write = canUse(
    bootstrap,
    moduleId,
    `${moduleId}.${resource}.write`,
    moduleCatalog,
  );
  const archiveWrite = canUse(
    bootstrap,
    moduleId,
    `${moduleId}.${archiveAttempt?.resource ?? resource}.write`,
    moduleCatalog,
  );
  const authorized = () => {
    const current = recoveryContext.current;
    return (
      mounted.current &&
      current.online &&
      navigator.onLine &&
      Date.now() <
        Date.parse(current.bootstrap.authorizedAt) +
          Math.max(current.bootstrap.offlineHours, 1 / 60) * 3600000
    );
  };
  const synchronize = async () => {
    const result = await synchronizeWorkspace(() =>
      mounted.current ? recoveryContext.current : undefined,
    );
    if (result.errors.length) throw result.errors[0];
  };
  const transport = (call: ModuleCall) => sendModuleCall(client, scope, call);
  const send = async (call: ModuleCall) => {
    const contract = responseModules.current.get(
      `${call.moduleId}@${call.moduleVersion}`,
    );
    if (!contract) throw new ResponseContractUnavailable();
    const result = await transport(call);
    validateModuleResponse(contract, call, result);
    return result;
  };
  const archive = async (call: ModuleCall) => {
    const retrying = !!archiveAttempt;
    if (archiveAttempt && archiveAttempt.key !== call.key) return;
    setArchiveNotice(undefined);
    setBusy(true);
    setError(undefined);
    try {
      if (!canRecoverCall(call))
        throw Error("Current access does not allow this archive.");
      if (!retrying) {
        const stored = await readModuleStorage(platform, scope);
        if (recordDependencies(call, stored.journal, scope).length)
          throw Error(
            "Resolve the pending changes for this record before archiving it.",
          );
        if (!canRecoverCall(call))
          throw Error("Current access changed before archiving.");
      }
      setArchiveAttempt(call);
      await send(call);
      if (!canRecoverCall(call))
        throw Error(
          "Current access changed. The original archive request is retained for recovery.",
        );
      setArchiveAttempt(undefined);
      await query.refetch();
    } catch (error) {
      if (isDefinitiveRejection(error, retrying)) setArchiveAttempt(undefined);
      setError(error);
    } finally {
      setBusy(false);
    }
  };
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
      ranges,
      orderBy,
    ],
    enabled: online && allowed && resourceAvailable,
    queryFn: async () => {
      const result = (await send({
        moduleId,
        moduleVersion: module.version,
        resource,
        action: "list",
        input: { search, cursor, archived, limit, where, ranges, orderBy },
      })) as ResourcePage;
      if (props.offlineEnabled && bootstrap.offlineHours > 0)
        await changeModuleStorage(platform, scope, (s) => {
          const current = recoveryContext.current;
          if (
            mounted.current &&
            current.scope.userId === scope.userId &&
            current.scope.workspaceId === scope.workspaceId &&
            current.module.id === moduleId &&
            current.module.version === module.version &&
            current.offlineEnabled &&
            current.bootstrap.offlineHours > 0 &&
            Date.now() <
              Date.parse(current.bootstrap.authorizedAt) +
                current.bootstrap.offlineHours * 3600000 &&
            canUse(
              current.bootstrap,
              moduleId,
              `${moduleId}.${resource}.read`,
              current.moduleCatalog,
            )
          )
            cacheResourcePage(s, pageKey, result);
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
    if (!separateCreate || !reviewedCreate || !storage) {
      setRecoveryDrafts([]);
      setCheckingDrafts(false);
      setDraftScanError(undefined);
      return;
    }
    let active = true;
    setCheckingDrafts(true);
    setDraftScanError(undefined);
    void collisionDrafts(storage, scope, reviewedCreate.id)
      .then((drafts) => {
        if (
          !drafts.every((draft) =>
            canRecoverCall({
              moduleId: draft.moduleId,
              moduleVersion: draft.moduleVersion,
              resource: draft.resource,
              action: draft.target ? "update" : "create",
              input: {},
            }),
          )
        )
          throw Error(
            "Current access does not allow reviewing every affected saved draft.",
          );
        if (active) setRecoveryDrafts(drafts);
      })
      .catch((error) => {
        if (active) {
          setRecoveryDrafts([]);
          setDraftScanError(error);
        }
      })
      .finally(() => {
        if (active) setCheckingDrafts(false);
      });
    return () => {
      active = false;
    };
  }, [separateCreate, reviewedCreate?.id, storage, bootstrap, online]);
  if (!allowed)
    return (
      <Empty
        title="Module access required"
        description="Ask your administrator for access to this module."
      />
    );
  const cachedPageKey =
    storage?.pages[pageKey] !== undefined
      ? pageKey
      : limit === 50 &&
          Object.keys(where).length === 0 &&
          Object.keys(ranges).length === 0 &&
          orderBy.length === 0
        ? `${moduleId}@${module.version}/${resource}/${search}/${cursor ?? ""}/${archived}`
        : undefined;
  const candidatePage = online
    ? query.data
    : cachedPageKey
      ? storage?.pages[cachedPageKey]
      : undefined;
  const downloadedAt =
    storage && cachedPageKey
      ? resourcePageDownloadedAt(storage, cachedPageKey)
      : undefined;
  let page: ResourcePage | undefined;
  let responseError: unknown;
  if (candidatePage !== undefined) {
    try {
      validateModuleResponse(
        module,
        {
          moduleId,
          moduleVersion: module.version,
          resource,
          action: "list",
          input: {},
        },
        candidatePage,
      );
      if (!online || !query.error) page = candidatePage;
    } catch (error) {
      responseError = error;
    }
  }
  const pending =
    storage?.journal.filter(
      (e) =>
        e.userId === scope.userId &&
        e.workspaceId === scope.workspaceId &&
        e.call.moduleId === moduleId &&
        e.call.resource === resource &&
        e.state !== "accepted" &&
        !e.supersededBy,
    ) ?? [];
  const directReviews = Object.keys(storage?.draftReviews ?? {}).filter(
    (key) =>
      key.startsWith(`${ordinaryDraftKey}/review/`) &&
      storage?.drafts[key] &&
      !storage.draftReviews?.[key]?.entryId,
  );
  function pendingLabel(input: unknown, fallback: string) {
    const command = input as { data?: Record<string, unknown>; id?: string };
    for (const column of definition.columns) {
      const value = command.data?.[column];
      if (typeof value === "string" && value.trim()) return value;
    }
    return command.id ?? fallback;
  }
  async function persistDraft(
    data: Record<string, unknown>,
    record: ResourceRecord | null,
    review = reviewSession,
  ) {
    if (!props.offlineEnabled || !bootstrap.offlineHours) return;
    await saveResourceDraft(platform, scope, moduleId, resource, {
      data,
      target: record,
      review,
      moduleVersion: module.version,
      generation:
        draftGeneration.current?.key ===
        resourceDraftKey(moduleId, resource, review)
          ? draftGeneration.current.value
          : 0,
    });
  }
  async function resumeDraft(key: string) {
    setBusy(true);
    setError(undefined);
    try {
      const stored = await read();
      let review = stored.draftReviews?.[key];
      const entry = review?.entryId
        ? stored.journal.find(
            (item) =>
              item.id === review?.entryId &&
              item.userId === scope.userId &&
              item.workspaceId === scope.workspaceId &&
              item.call.moduleId === moduleId &&
              item.call.resource === resource &&
              !item.supersededBy &&
              ["conflict", "rejected"].includes(item.state),
          )
        : undefined;
      if (!stored.drafts[key] || (review?.entryId && !entry))
        throw Error(
          "This review has already been replaced. Refresh pending changes.",
        );
      if (review?.collision && !review.collision.ready) {
        if (
          !online ||
          !stored.journal.some(
            (entry) =>
              entry.id === review!.collision!.parentId &&
              entry.userId === scope.userId &&
              entry.workspaceId === scope.workspaceId &&
              entry.state === "accepted",
          )
        )
          throw Error(
            "Connect after the separate record is accepted to review this saved draft.",
          );
        const source = review.collision;
        const target = source.targetId
          ? ((await send({
              moduleId,
              moduleVersion: module.version,
              resource,
              action: "get",
              input: { id: source.targetId },
            })) as ResourceRecord)
          : null;
        const compared =
          target && !target.archived
            ? reviewFields(
                source.sourceTarget?.data,
                stored.drafts[key],
                target.data,
              )
            : undefined;
        review = {
          ...review,
          collision: { ...source, ready: true },
          comparison: compared?.review,
          ...(target?.archived
            ? {
                recoveryInput: {
                  moduleVersion: source.moduleVersion ?? module.version,
                  recordId: source.sourceTarget?.id,
                  baseVersion: source.sourceTarget?.version,
                },
              }
            : {}),
        };
        const data = compared?.data ?? stored.drafts[key];
        await saveResourceDraft(platform, scope, moduleId, resource, {
          data,
          target,
          review,
          moduleVersion: module.version,
        });
        stored.drafts[key] = data;
        (stored.draftTargets ??= {})[key] = target;
      }
      if (
        review &&
        entry &&
        canonical(review.createRecovery ?? []) !==
          canonical(entry.createRecovery ?? [])
      ) {
        if (
          !online ||
          entry.dependencies.some(
            (id) =>
              !stored.journal.some(
                (candidate) =>
                  candidate.id === id &&
                  candidate.userId === scope.userId &&
                  candidate.workspaceId === scope.workspaceId &&
                  candidate.state === "accepted",
              ),
          )
        )
          throw Error(
            "Connect after prerequisite changes are accepted to refresh this saved review.",
          );
        const command = entry.call.input as {
          id?: string;
          data?: Record<string, unknown>;
          baseData?: Record<string, unknown>;
          baseVersion?: number;
        };
        const target =
          entry.call.action === "update"
            ? ((await send({
                moduleId: entry.call.moduleId,
                moduleVersion: module.version,
                resource: entry.call.resource,
                action: "get",
                input: {
                  id: entry.recordRecovery?.targetId ?? command.id,
                },
              })) as ResourceRecord)
            : null;
        const comparison =
          target && !target.archived
            ? reviewFields(command.baseData, stored.drafts[key], target.data)
            : undefined;
        review = {
          ...review,
          createRecovery: entry.createRecovery
            ? structuredClone(entry.createRecovery)
            : undefined,
          comparison: comparison?.review,
          recoveryInput: target?.archived
            ? {
                moduleVersion: entry.call.moduleVersion ?? module.version,
                baseVersion: command.baseVersion,
                ...(entry.recordRecovery ? { recordId: command.id } : {}),
              }
            : undefined,
        };
        const refreshed = comparison?.data ?? stored.drafts[key];
        await saveResourceDraft(platform, scope, moduleId, resource, {
          data: refreshed,
          target,
          review,
          moduleVersion: module.version,
        });
        stored.drafts[key] = refreshed;
        (stored.draftTargets ??= {})[key] = target;
      }
      draftGeneration.current = {
        key,
        value: stored.draftGenerations?.[key] ?? 0,
      };
      setForm(stored.drafts[key]);
      setEditing(stored.draftTargets?.[key] ?? null);
      setReviewSession(review);
      setReviewTargetId(
        entry?.recordRecovery?.targetId ??
          (entry?.call.input as { id?: string } | undefined)?.id,
      );
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  const settlementTransport: SettlementTransport = ({
    moduleId,
    moduleVersion,
    body,
  }) =>
    client.request({
      operation: "moduleAttemptSettle",
      params: { workspaceId: scope.workspaceId, moduleId },
      moduleVersion,
      body,
    });
  function canRecoverCall(call: ModuleCall) {
    const current = recoveryContext.current;
    return (
      mounted.current &&
      current.scope.userId === scope.userId &&
      current.scope.workspaceId === scope.workspaceId &&
      current.online &&
      navigator.onLine &&
      Date.now() <
        new Date(current.bootstrap.authorizedAt).getTime() +
          Math.max(current.bootstrap.offlineHours, 1 / 60) * 3600000 &&
      !!call.resource &&
      canUse(
        current.bootstrap,
        call.moduleId,
        `${call.moduleId}.${call.resource}.read`,
        current.moduleCatalog,
      ) &&
      canUse(
        current.bootstrap,
        call.moduleId,
        `${call.moduleId}.${call.resource}.write`,
        current.moduleCatalog,
      )
    );
  }
  function settleDirectCall(call: ModuleCall) {
    return settleModuleCall(call, settlementTransport, (result) => {
      const original = responseModules.current.get(
        `${call.moduleId}@${call.moduleVersion}`,
      );
      if (!original) throw new ResponseContractUnavailable();
      validateModuleResponse(original, call, result);
    });
  }
  async function createSeparateRecord() {
    if (
      (!reviewedCreate && !directCreate) ||
      !online ||
      !write ||
      !authorized()
    )
      return;
    setBusy(true);
    setError(undefined);
    try {
      if (!resourceAvailable)
        throw Error(
          "This resource was removed in the current release. Export your input before closing the editor.",
        );
      assertSchema(definition.schema, form);
      const replacement: ModuleCall = {
        moduleId,
        moduleVersion: module.version,
        resource,
        action: "create",
        key: crypto.randomUUID(),
        input: { id: crypto.randomUUID(), data: structuredClone(form) },
      };
      if (directCreate) {
        const original = directCreate.call;
        if (!canRecoverCall(original) || !canRecoverCall(replacement))
          throw Error("Current access does not allow recovery of this create.");
        const result = await settleDirectCall(original);
        if (!canRecoverCall(original) || !canRecoverCall(replacement))
          throw Error(
            "Current access changed during recovery. Your input is preserved.",
          );
        if (result.outcome === "cancelled") {
          // The original key is permanently fenced. The replacement has its own
          // delivery lifecycle; a lost reply must keep its new key uncertain.
          setSeparateCreate(false);
          setDirectCreate(undefined);
          setReviewTargetId((replacement.input as { id: string }).id);
          return await save(replacement);
        }
        if (props.offlineEnabled && bootstrap.offlineHours > 0)
          await changeModuleStorage(platform, scope, (stored) =>
            removeResourceDraft(stored, draftKey),
          );
        setDirectCreate(undefined);
      } else {
        const state = await readModuleStorage(platform, scope);
        const commands = new Map<string, ContinuationAccess>();
        for (const entry of createCommandDependents(
          state,
          scope,
          reviewedCreate!.id,
        )) {
          const access = await prepareContinuation(
            recoveryContext.current,
            state,
            entry.call,
          );
          if (access) commands.set(continuationKey(entry.call), access);
        }
        await replaceFailedCreate(
          platform,
          scope,
          reviewedCreate!.id,
          replacement,
          settlementTransport,
          (call, stored) =>
            call.action !== "operation"
              ? canRecoverCall(call)
              : authorized() &&
                recoveryContext.current.scope.userId === scope.userId &&
                recoveryContext.current.scope.workspaceId ===
                  scope.workspaceId &&
                canContinue(
                  recoveryContext.current,
                  call,
                  commands.get(continuationKey(call)),
                  stored,
                ),
          recoveryTargets,
          draftChoices,
        );
      }
      setSeparateCreate(false);
      setEditing(undefined);
      setReviewSession(undefined);
      setReviewTargetId(undefined);
      await synchronize();
      await query.refetch();
    } catch (error) {
      setError(error);
    } finally {
      await read().catch(setError);
      setBusy(false);
    }
  }
  async function prepareDirectReview(call: ModuleCall) {
    const input = call.input as {
      id: string;
      data: Record<string, unknown>;
      baseData?: Record<string, unknown>;
      baseVersion?: number;
    };
    const current = (await send({
      moduleId: call.moduleId,
      moduleVersion: module.version,
      resource: call.resource,
      action: "get",
      input: { id: input.id },
    })) as ResourceRecord;
    const comparison = current.archived
      ? undefined
      : reviewFields(input.baseData, input.data, current.data);
    const review = {
      draftId: call.key ?? crypto.randomUUID(),
      comparison: comparison?.review,
      ...(current.archived
        ? {
            recoveryInput: {
              moduleVersion: call.moduleVersion ?? module.version,
              baseVersion: input.baseVersion,
            },
          }
        : {}),
    };
    const data = comparison?.data ?? input.data;
    setEditing(current);
    setForm(data);
    setReviewSession(review);
    await persistDraft(data, current, review);
    if (current.archived) await query.refetch();
    return current.archived;
  }
  async function resolveOutcome() {
    if (
      !settling ||
      !online ||
      !(settling.type === "archive" ? archiveWrite : write) ||
      !authorized()
    )
      return;
    setBusy(true);
    setError(undefined);
    try {
      if (settling.type === "journal") {
        await settleJournalEntry(
          platform,
          scope,
          settling.id,
          settlementTransport,
          authorized,
        );
      } else {
        const call =
          settling.type === "edit" ? attempt.current : archiveAttempt;
        if (!call) throw Error("This change no longer needs outcome recovery.");
        if (!canRecoverCall(call))
          throw Error(
            "Current access does not allow recovery of the original change.",
          );
        const result = await settleDirectCall(call);
        if (!canRecoverCall(call))
          throw Error(
            "Unlock this workspace again to recover its confirmed outcome.",
          );
        if (settling.type === "archive") {
          setArchiveAttempt(undefined);
          setArchiveNotice(
            result.outcome === "accepted"
              ? "Archive confirmed."
              : "The original archive request was stopped. Review the current record before archiving again.",
          );
        } else {
          if (result.outcome === "accepted") {
            if (props.offlineEnabled && bootstrap.offlineHours > 0)
              await changeModuleStorage(platform, scope, (stored) => {
                removeResourceDraft(stored, draftKey);
              });
            attempt.current = undefined;
            setEditing(undefined);
            setReviewSession(undefined);
            setReviewTargetId(undefined);
          } else {
            attempt.current = undefined;
            setReviewTargetId((call.input as { id?: string }).id);
            setSettling(undefined);
            if (call.action === "update") await prepareDirectReview(call);
            else if (call.action === "create")
              setDirectCreate({ call, collision: false, cancelled: true });
          }
        }
      }
      setSettling(undefined);
      await synchronize();
      await read();
      await query.refetch();
    } catch (error) {
      setError(error);
    } finally {
      setBusy(false);
    }
  }
  async function save(preparedCreate?: ModuleCall) {
    const retrying = !!attempt.current;
    let confirmed = false;
    setBusy(true);
    setError(undefined);
    try {
      if (!attempt.current) {
        if (editing?.archived)
          throw Error(
            "This record is archived. Export the preserved input instead.",
          );
        if (identityCollision && !preparedCreate)
          throw Error(
            "This identity already exists. Review the separate-record option to keep your input.",
          );
        if (unresolved.length)
          throw Error(
            "Choose a value for each conflicting field before saving.",
          );
        if (!write) throw Error("Your role no longer allows this change.");
        if (!resourceAvailable)
          throw Error(
            "This resource was removed in the current release. Export your input before closing the editor.",
          );
        if (
          !preparedCreate &&
          props.offlineEnabled &&
          bootstrap.offlineHours > 0
        ) {
          const current = await readModuleStorage(platform, scope);
          if (
            !reviewSession &&
            (current.draftGenerations?.[ordinaryDraftKey] ?? 0) !==
              (draftGeneration.current?.value ?? 0)
          )
            throw Error(
              "This draft was moved or submitted in another view. Your open input is preserved; reopen its saved review.",
            );
          if (reviewSession?.collision) {
            const saved = current.draftReviews?.[draftKey]?.collision;
            if (
              !saved?.ready ||
              !current.journal.some(
                (entry) =>
                  entry.id === saved.parentId && entry.state === "accepted",
              )
            )
              throw Error(
                "Reopen this saved review after its prerequisite is accepted.",
              );
          }
        }
        assertSchema(definition.schema, form);
      }
      const call: ModuleCall = attempt.current ??
        preparedCreate ?? {
          moduleId,
          moduleVersion: module.version,
          resource,
          action: editing ? "update" : "create",
          input: editing
            ? {
                id: editing.id,
                data: form,
                baseVersion: editing.version,
                baseData: structuredClone(editing.data),
              }
            : { id: reviewTargetId ?? crypto.randomUUID(), data: form },
          key: crypto.randomUUID(),
        };
      const durable =
        preparedCreate || directCreate
          ? false
          : attempt.current
            ? attemptMode.current === "journal"
            : !!reviewId ||
              (definition.policy === "queued" &&
                props.offlineEnabled &&
                bootstrap.offlineHours > 0);
      attemptMode.current = durable ? "journal" : "direct";
      if (!durable) {
        if (!online) throw Error("Connect to save this change.");
        attempt.current = call;
        setDirectCreate(undefined);
        await send(call);
        confirmed = true;
      } else {
        if (
          !online &&
          (definition.policy === "online" ||
            !props.offlineEnabled ||
            !bootstrap.offlineHours)
        )
          throw Error("Connect to submit this reviewed change.");
        attempt.current = call;
        await enqueue(platform, scope, call, [], {
          draftKey,
          supersedes: reviewId,
          createRecovery: reviewSession?.createRecovery,
          generation:
            draftGeneration.current?.key === draftKey
              ? draftGeneration.current.value
              : 0,
        });
        attempt.current = undefined;
        setEditing(undefined);
        setReviewSession(undefined);
        setReviewTargetId(undefined);
        if (online) await synchronize();
      }
      if (!durable && props.offlineEnabled && bootstrap.offlineHours > 0)
        await changeModuleStorage(platform, scope, (stored) => {
          removeResourceDraft(stored, draftKey);
        });
      attempt.current = undefined;
      setReviewSession(undefined);
      setReviewTargetId(undefined);
      setEditing(undefined);
      await read();
      if (online) await query.refetch();
    } catch (e) {
      const failed = attempt.current;
      if (
        (!confirmed && isDefinitiveRejection(e, retrying)) ||
        (e instanceof Error &&
          "code" in e &&
          e.code === "JOURNAL_CONFLICT" &&
          attemptMode.current === "journal")
      ) {
        attempt.current = undefined;
        if (
          failed?.action === "create" &&
          attemptMode.current === "direct" &&
          (e as { code?: string })?.code === "RECORD_EXISTS"
        ) {
          setDirectCreate({ call: failed, collision: true, cancelled: false });
          setReviewTargetId((failed.input as { id: string }).id);
          return;
        }
        if (
          failed?.action === "update" &&
          attemptMode.current === "direct" &&
          ((e as { status?: number }).status === 412 ||
            (e as { code?: string }).code === "RECORD_ARCHIVED")
        ) {
          try {
            if (await prepareDirectReview(failed)) return;
          } catch (reviewError) {
            setError(reviewError);
            return;
          }
        }
      }
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
          <>
            <SavedCommands state={queued} />
            {write && (
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
                  setReviewSession(undefined);
                  setReviewTargetId(undefined);
                  setDirectCreate(undefined);
                  draftGeneration.current = {
                    key: ordinaryDraftKey,
                    value: storage?.draftGenerations?.[ordinaryDraftKey] ?? 0,
                  };
                  setEditing(null);
                }}
              >
                <Plus size={16} />
                New {definition.title.toLowerCase()}
              </Button>
            )}
          </>
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
          setRanges({});
          setOrderBy([]);
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
          {write && storage?.drafts[ordinaryDraftKey] && (
            <Button onClick={() => void resumeDraft(ordinaryDraftKey)}>
              Resume saved draft
            </Button>
          )}
        </div>
        <div className="resource-query-controls">
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
          <TypedResourceRanges
            key={`ranges/${resource}@${module.version}`}
            schema={definition.schema as TObject}
            value={ranges}
            onChange={(next) => {
              setRanges(next);
              resetPage();
            }}
          />
          <TypedResourceSort
            key={`sort/${resource}@${module.version}`}
            schema={definition.schema as TObject}
            value={orderBy}
            onChange={(next) => {
              setOrderBy([...next]);
              resetPage();
            }}
          />
        </div>
        {!online && (
          <p role="status">
            <span>
              {page ? "Offline copy." : "This page is not available offline."}{" "}
              Changes remain pending until the server accepts them.
            </span>
            {page && (
              <>
                {" "}
                {downloadedAt ? (
                  <>
                    Downloaded{" "}
                    <time dateTime={new Date(downloadedAt).toISOString()}>
                      {new Date(downloadedAt).toLocaleString()}
                    </time>
                    .{" "}
                  </>
                ) : (
                  "Download time unavailable. "
                )}
                This information may be out of date.
              </>
            )}
          </p>
        )}
        <ErrorMessage
          error={error ?? responseError ?? (online ? query.error : undefined)}
        />
        {archiveNotice && <p role="status">{archiveNotice}</p>}
        {archiveAttempt && (
          <div className="module-toolbar">
            <p role="status">
              The archive response is uncertain. Retry the same request to
              confirm it.
            </p>
            <Button
              disabled={!online || !archiveWrite || busy}
              onClick={() => void archive(archiveAttempt)}
            >
              Retry archive
            </Button>
            <Button
              disabled={!online || !archiveWrite || busy}
              onClick={() => {
                setError(undefined);
                setSettling({ type: "archive" });
              }}
            >
              Resolve archive outcome
            </Button>
          </div>
        )}
        {online && query.isLoading ? (
          <Loading />
        ) : responseError || (online && query.error) ? (
          <Empty
            title="Records unavailable"
            description={
              online
                ? "The response could not be verified. Retry loading these records."
                : "This offline copy could not be verified. Reconnect to refresh it."
            }
            action={
              online ? (
                <Button onClick={() => void query.refetch()}>
                  Retry records
                </Button>
              ) : undefined
            }
          />
        ) : !page?.items.length ? (
          <Empty
            title="No records"
            description={
              online
                ? search ||
                  Object.keys(where).length ||
                  Object.keys(ranges).length ||
                  archived ||
                  cursor
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
                      draftGeneration.current = {
                        key: ordinaryDraftKey,
                        value:
                          storage?.draftGenerations?.[ordinaryDraftKey] ?? 0,
                      };
                      setEditing(row);
                      setForm(row.data);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={
                      !online ||
                      busy ||
                      !!archiveAttempt ||
                      pending.some(
                        (entry) =>
                          (entry.recordRecovery?.targetId ??
                            (entry.call.input as { id?: string }).id) ===
                          row.id,
                      )
                    }
                    onClick={() =>
                      void archive({
                        moduleId,
                        moduleVersion: module.version,
                        resource,
                        action: "archive",
                        input: { id: row.id, baseVersion: row.version },
                        key: crypto.randomUUID(),
                      })
                    }
                  >
                    Archive
                  </Button>
                  {pending.some(
                    (entry) =>
                      (entry.recordRecovery?.targetId ??
                        (entry.call.input as { id?: string }).id) === row.id,
                  ) && <span>Resolve pending changes before archiving.</span>}
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
            {page
              ? `Page ${previous.length + 1}. ${page.items.length} ${page.items.length === 1 ? "record" : "records"}.`
              : "Record count unavailable."}
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
        {directReviews.length > 0 && (
          <section className="panel" aria-label="Saved reviews">
            <h2>Saved reviews</h2>
            {directReviews.map((key) => (
              <div
                className="module-pending"
                key={key}
                role="group"
                aria-label={`Saved review: ${pendingLabel({ data: storage!.drafts[key], id: storage!.draftTargets?.[key]?.id }, key)}`}
              >
                <strong style={{ overflowWrap: "anywhere", maxWidth: "100%" }}>
                  {pendingLabel(
                    {
                      data: storage!.drafts[key],
                      id: storage!.draftTargets?.[key]?.id,
                    },
                    key,
                  )}
                </strong>
                <Button
                  disabled={!write || busy}
                  onClick={() => void resumeDraft(key)}
                >
                  Resume review
                </Button>
              </div>
            ))}
          </section>
        )}
        {!!pending.length && (
          <section className="panel">
            <h2>Pending changes</h2>
            {pending.map((entry) => (
              <div
                className="module-pending"
                key={entry.id}
                role="group"
                aria-label={`Pending ${entry.call.action}: ${pendingLabel(entry.call.input, entry.id)}`}
              >
                <strong style={{ overflowWrap: "anywhere", maxWidth: "100%" }}>
                  {fieldLabel(entry.call.action)}:{" "}
                  {pendingLabel(entry.call.input, entry.id)}
                </strong>
                <span>
                  {fieldLabel(entry.state)}.{" "}
                  {(entry.orderingRecovery === "outcome"
                    ? "Earlier versions did not record a safe order for these edits. Resolve this change's outcome before continuing."
                    : entry.orderingRecovery === "waiting"
                      ? "Waiting for the outcomes of older edits to this record. Unrelated work can still synchronize."
                      : entry.error) ??
                    (entry.dependencies.some(
                      (id) =>
                        !storage?.journal.some(
                          (candidate) =>
                            candidate.id === id &&
                            candidate.state === "accepted",
                        ),
                    )
                      ? "Waiting for prerequisite changes to be accepted. Unrelated work can still synchronize."
                      : "Waiting for server acceptance")}
                </span>
                {entry.state === "pending" &&
                entry.delivery !== "unsubmitted" ? (
                  <Button
                    disabled={!online || !write || busy}
                    onClick={() => {
                      setError(undefined);
                      setSettling({ type: "journal", id: entry.id });
                    }}
                  >
                    Resolve outcome
                  </Button>
                ) : (
                  <Button
                    disabled={
                      (!online &&
                        !storage?.drafts[
                          resourceDraftKey(moduleId, resource, {
                            entryId: entry.id,
                          })
                        ]) ||
                      !allowed ||
                      busy ||
                      entry.state === "pending" ||
                      !!(
                        (entry.recordRecovery ||
                          entry.createRecovery?.length) &&
                        entry.dependencies.some(
                          (id) =>
                            !storage?.journal.some(
                              (candidate) =>
                                candidate.id === id &&
                                candidate.state === "accepted",
                            ),
                        )
                      )
                    }
                    onClick={async () => {
                      if (entry.call.action === "archive") {
                        setArchiveReviewId(entry.id);
                        return;
                      }
                      const key = resourceDraftKey(moduleId, resource, {
                        entryId: entry.id,
                      });
                      if (storage?.drafts[key]) return resumeDraft(key);
                      const command = entry.call.input as {
                        id?: string;
                        data?: Record<string, unknown>;
                        baseData?: Record<string, unknown>;
                        baseVersion?: number;
                      };
                      setBusy(true);
                      setError(undefined);
                      try {
                        const current =
                          entry.call.action === "update"
                            ? ((await send({
                                moduleId,
                                moduleVersion: module.version,
                                resource,
                                action: "get",
                                input: {
                                  id:
                                    entry.recordRecovery?.targetId ??
                                    command.id,
                                },
                              })) as ResourceRecord)
                            : null;
                        const comparison =
                          current && !current.archived
                            ? reviewFields(
                                command.baseData,
                                command.data ?? {},
                                current.data,
                              )
                            : undefined;
                        const session = {
                          entryId: entry.id,
                          ...(entry.createRecovery
                            ? {
                                createRecovery: structuredClone(
                                  entry.createRecovery,
                                ),
                              }
                            : {}),
                          comparison: comparison?.review,
                          ...(current?.archived
                            ? {
                                recoveryInput: {
                                  moduleVersion:
                                    entry.call.moduleVersion ?? module.version,
                                  baseVersion: command.baseVersion,
                                  ...(entry.recordRecovery
                                    ? { recordId: command.id }
                                    : {}),
                                },
                              }
                            : {}),
                        };
                        const next = comparison?.data ?? command.data ?? {};
                        await persistDraft(next, current, session);
                        setForm(next);
                        setEditing(current);
                        setReviewSession(session);
                        setReviewTargetId(
                          entry.recordRecovery?.targetId ?? command.id,
                        );
                      } catch (e) {
                        setError(e);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {storage?.drafts[
                      resourceDraftKey(moduleId, resource, {
                        entryId: entry.id,
                      })
                    ]
                      ? "Resume review"
                      : "Review"}
                  </Button>
                )}
                {entry.call.action === "archive" && (
                  <details>
                    <summary>View archive target</summary>
                    <ResourceValue value={entry.call.input} />
                  </details>
                )}
                {["create", "update"].includes(entry.call.action) && (
                  <SavedChange
                    entry={entry}
                    schema={definition.schema as TObject}
                    loadReferences={loadReferences}
                  />
                )}
              </div>
            ))}
          </section>
        )}
      </section>
      <Modal
        title="Resolve pending change"
        open={!!settling}
        description="Confirm acceptance or stop further retries."
        onOpenChange={(open) => {
          if (!open && !busy) setSettling(undefined);
        }}
      >
        <p>
          The server will check whether this change committed. If it did not,
          the server will stop further retries so you can review a correction.
          Your input is kept.
        </p>
        <ErrorMessage error={error} />
        <Button
          variant="primary"
          disabled={
            !online ||
            !(settling?.type === "archive" ? archiveWrite : write) ||
            busy
          }
          onClick={() => void resolveOutcome()}
        >
          Check and resolve
        </Button>
      </Modal>
      {archiveReview && (
        <ArchiveReview
          key={archiveReview.id}
          entry={archiveReview}
          module={module}
          allowed={
            canRecoverCall(archiveReview.call) &&
            !!module.resources[archiveReview.call.resource!]
          }
          busy={busy}
          load={async (call) => {
            if (!canRecoverCall(call))
              throw Error("Current access does not allow reading this record.");
            const value = (await send(call)) as ResourceRecord;
            if (!canRecoverCall(call))
              throw Error("Current access changed while reading this record.");
            return value;
          }}
          close={() => setArchiveReviewId(undefined)}
          resolve={async () => {
            setBusy(true);
            try {
              await settleJournalEntry(
                platform,
                scope,
                archiveReview.id,
                settlementTransport,
                () => canRecoverCall(archiveReview.call),
                "saved-resource",
              );
              setArchiveReviewId(undefined);
              await query.refetch();
            } finally {
              try {
                await read();
              } finally {
                setBusy(false);
              }
            }
          }}
          submit={async (call, context) => {
            setBusy(true);
            try {
              await replaceArchive(
                platform,
                scope,
                archiveReview.id,
                call,
                settlementTransport,
                canRecoverCall,
                context,
              );
              setArchiveReviewId(undefined);
              await synchronize();
              await query.refetch();
            } finally {
              try {
                await read();
              } finally {
                setBusy(false);
              }
            }
          }}
        />
      )}
      <Modal
        title="Create a separate record"
        description="Recover a failed create with a new record identity."
        open={separateCreate}
        onOpenChange={(open) => {
          if (!open && !busy) setSeparateCreate(false);
        }}
      >
        <p>
          The server will check the original request first. If it already
          committed, its result will be recovered. Otherwise, the server will
          stop the original request before{" "}
          {directCreate
            ? "submitting your input with a new identity. Success requires server acceptance."
            : "saving your input as a new pending create."}
        </p>
        {!directCreate && (
          <p>
            Other linked records that have never been submitted will follow the
            new record. Later changes to this record need an explicit target and
            review. Linked custom commands keep their original input and need a
            separate review after their prerequisites are accepted. Existing
            server records and accepted effects stay unchanged. Recover linked
            requests with uncertain outcomes from Settings before continuing.
            Commands stopped by the server still need an explicit review.
            Ambiguous saved drafts must be reviewed first.
          </p>
        )}
        {!!recoveryEdits.length && (
          <div className="form-stack">
            <p>
              Choose where each later change belongs. These changes will remain
              saved for review against the chosen record after prerequisite
              changes are accepted.
            </p>
            {recoveryEdits.map((entry, index) => (
              <div className="form-stack" key={entry.id}>
                <Field
                  label={`Record for later ${entry.call.action === "archive" ? "archive" : "edit"} ${index + 1}`}
                >
                  <Select
                    value={recoveryTargets[entry.id] ?? ""}
                    disabled={busy}
                    onValueChange={(value) => {
                      setRecoveryTargets((current) => {
                        const next = { ...current };
                        if (value === "separate" || value === "existing")
                          next[entry.id] = value;
                        else delete next[entry.id];
                        return next;
                      });
                    }}
                  >
                    <SelectOption value="">Choose a record</SelectOption>
                    <SelectOption value="separate">
                      Separate record
                    </SelectOption>
                    <SelectOption value="existing">
                      Existing corporate record
                    </SelectOption>
                  </Select>
                </Field>
                {entry.call.action === "archive" ? (
                  <details>
                    <summary>View archive target</summary>
                    <ResourceValue value={entry.call.input} expanded />
                  </details>
                ) : (
                  <SavedChange
                    entry={entry}
                    schema={definition.schema as TObject}
                    loadReferences={loadReferences}
                  />
                )}
              </div>
            ))}
          </div>
        )}
        {checkingDrafts && <p role="status">Checking saved drafts…</p>}
        {!!recoveryDrafts.length && (
          <section className="form-stack" aria-label="Saved draft choices">
            <p>
              These saved drafts may refer to the colliding record. Choose where
              their links or record edits belong. Supported drafts will remain
              saved for review; this does not submit them.
            </p>
            {recoveryDrafts.map((draft, index) => (
              <div className="form-stack" key={draft.key}>
                <p>{draft.title}</p>
                {!draft.movable && (
                  <p>
                    This draft cannot be moved safely. Keep its input unchanged
                    and review it in its original module.
                  </p>
                )}
                <Field label={`Record for saved draft ${index + 1}`}>
                  <Select
                    value={
                      draftChoices[draft.key]?.fingerprint === draft.fingerprint
                        ? (draftChoices[draft.key]?.destination ?? "")
                        : ""
                    }
                    disabled={busy}
                    onValueChange={(value) =>
                      setDraftChoices((current) => {
                        const next = { ...current };
                        if (value === "separate" || value === "existing")
                          next[draft.key] = {
                            fingerprint: draft.fingerprint,
                            destination: value,
                          };
                        else delete next[draft.key];
                        return next;
                      })
                    }
                  >
                    <SelectOption value="">Choose a record</SelectOption>
                    {draft.movable && (
                      <SelectOption value="separate">
                        Separate record
                      </SelectOption>
                    )}
                    <SelectOption value="existing">
                      {draft.movable
                        ? "Existing corporate record"
                        : "Keep input unchanged"}
                    </SelectOption>
                  </Select>
                </Field>
                <SavedDraft
                  unsubmitted={draft.movable}
                  data={draft.data}
                  target={draft.target}
                  schema={(draft.schema ?? Type.Object({})) as TObject}
                />
              </div>
            ))}
          </section>
        )}
        <ErrorMessage error={draftScanError ?? error} />
        <Button
          variant="primary"
          disabled={
            !online ||
            !write ||
            busy ||
            checkingDrafts ||
            !!draftScanError ||
            recoveryEdits.some((entry) => !recoveryTargets[entry.id]) ||
            recoveryDrafts.some(
              (draft) =>
                draftChoices[draft.key]?.fingerprint !== draft.fingerprint,
            )
          }
          onClick={() => void createSeparateRecord()}
        >
          Check and create separate record
        </Button>
      </Modal>
      <Modal
        open={
          editing !== undefined && settling?.type !== "edit" && !separateCreate
        }
        onOpenChange={(open) => {
          if (!open && !attempt.current) {
            setEditing(undefined);
            setReviewSession(undefined);
            setReviewTargetId(undefined);
            setDirectCreate(undefined);
            void read();
          }
        }}
        title={
          editing?.archived
            ? "Recover input"
            : editing
              ? "Edit record"
              : "New record"
        }
        description={
          editing?.archived
            ? "Recover your saved edit without changing the archived record."
            : resourceAvailable
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
          {(reviewedCreate || directCreate) && (
            <section className="form-stack" aria-label="Failed create recovery">
              <p role="status">
                {identityCollision
                  ? "A record with this identity already exists. Your input has not replaced it."
                  : directCreate?.cancelled
                    ? "The server stopped the original create. Review your input before retrying or creating a separate record."
                    : "This create was not accepted. Review your input before retrying or creating a separate record."}
              </p>
              <Button
                type="button"
                disabled={!online || !write || busy}
                onClick={() => {
                  setError(undefined);
                  setRecoveryTargets({});
                  setDraftChoices({});
                  setRecoveryDrafts([]);
                  setCheckingDrafts(true);
                  setSeparateCreate(true);
                }}
              >
                Create separate record
              </Button>
              {directCreate && (
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() => void exportInput()}
                >
                  Export input
                </Button>
              )}
            </section>
          )}
          <CreateRecoveryNotice context={reviewSession?.createRecovery} />
          {reviewSession?.comparison && editing && (
            <ConflictReview
              review={reviewSession.comparison}
              loadReferences={loadReferences}
              version={editing.version}
              schema={definition.schema as TObject}
              disabled={busy || !!attempt.current}
              onChoose={(field, source) => {
                const next = chooseReviewField(
                  reviewSession.comparison!,
                  form,
                  field,
                  source,
                );
                const review = { ...reviewSession, comparison: next.review };
                setForm(next.data);
                setReviewSession(review);
                void persistDraft(next.data, editing, review).catch(setError);
              }}
            />
          )}
          {unresolved.length > 0 && (
            <p role="status">
              Choose values for {unresolved.length} conflicting{" "}
              {unresolved.length === 1 ? "field" : "fields"} before editing or
              saving.
            </p>
          )}
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
          {editing?.archived ? (
            <ArchivedInput
              schema={definition.schema as TObject}
              data={form}
              columns={definition.columns}
              loadReferences={loadReferences}
            />
          ) : (
            <fieldset
              disabled={
                busy ||
                !!attempt.current ||
                unresolved.length > 0 ||
                !!editing?.archived ||
                !write
              }
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
                  void persistDraft(v, editing ?? null).catch(setError);
                }}
              />
            </fieldset>
          )}
          {attempt.current && (
            <section className="form-stack" aria-label="Unconfirmed change">
              <p role="status">
                The server response is uncertain. Retry this same change or
                resolve its outcome before editing or closing it.
              </p>
              {attemptMode.current === "direct" && (
                <Button
                  type="button"
                  disabled={!online || !write || busy}
                  onClick={() => {
                    setError(undefined);
                    setSettling({ type: "edit" });
                  }}
                >
                  Resolve outcome
                </Button>
              )}
              <Button
                type="button"
                disabled={busy}
                onClick={() => void exportInput()}
              >
                Export pending input
              </Button>
            </section>
          )}
          <ErrorMessage error={error} />
          {!online && requiresConnection && !editing?.archived && (
            <p role="status">
              {attempt.current
                ? "Connect to confirm or resolve this pending change."
                : "You can keep editing this draft offline. Connect to submit it."}
            </p>
          )}
          {!editing?.archived && (
            <Button
              type="submit"
              variant="primary"
              disabled={
                (!online && requiresConnection) ||
                busy ||
                !write ||
                unresolved.length > 0 ||
                identityCollision ||
                ((!resourceAvailable || !!editing?.archived) &&
                  !attempt.current)
              }
            >
              {online || requiresConnection ? "Save" : "Save pending change"}
            </Button>
          )}
          {editing?.archived && !attempt.current && (
            <Button
              type="button"
              variant="primary"
              onClick={() => void exportInput()}
            >
              Export input
            </Button>
          )}
        </form>
      </Modal>
    </>
  );
}
