import type { ComponentType } from "react";
import {
  assertSchema,
  type ModuleDefinition,
  type Static,
  type TSchema,
  type createModuleClient,
} from "./index";

export interface ViewCheckpoint {
  viewId: string;
  version: number;
  moduleVersion: string;
  value: unknown;
}
export type ReadonlyViewState<T> = T extends readonly (infer I)[]
  ? readonly ReadonlyViewState<I>[]
  : T extends object
    ? { readonly [K in keyof T]: ReadonlyViewState<T[K]> }
    : T;
export interface EditableViewState<T> {
  readonly value: ReadonlyViewState<T> | undefined;
  /** Validated and retained in this account/workspace's live view session. */
  save(value: T): void;
  clear(): void;
}
type StatefulKeys<M extends ModuleDefinition> = {
  [K in keyof NonNullable<M["views"]>]: NonNullable<M["views"]>[K] extends {
    state: { schema: TSchema };
  }
    ? K
    : never;
}[keyof NonNullable<M["views"]>] &
  string;
type ViewState<
  M extends ModuleDefinition,
  K extends StatefulKeys<M>,
> = NonNullable<M["views"]>[K] extends {
  state: { schema: infer S extends TSchema };
}
  ? Static<S>
  : never;
export interface ViewStateMetadata {
  viewId: string;
  version: number;
  restore?: (checkpoint: Readonly<ViewCheckpoint>) => unknown;
}

/** The renderer supplies this context. Corporate requests always recheck authority. */
export interface ModuleViewProps<M extends ModuleDefinition> {
  client: ReturnType<typeof createModuleClient<M>>;
  scope: Readonly<{ userId: string; workspaceId: string }>;
  online: boolean;
  hasPermission: (permission: M["permissions"][number]) => boolean;
}

export function defineView<const M extends ModuleDefinition>(
  _module: M,
  component: ComponentType<ModuleViewProps<M>>,
): ComponentType<ModuleViewProps<M>>;
export function defineView<
  const M extends ModuleDefinition,
  K extends StatefulKeys<M>,
>(
  module: M,
  viewId: K,
  component: ComponentType<
    ModuleViewProps<M> & { state: EditableViewState<ViewState<M, K>> }
  >,
  options?: {
    restore: (checkpoint: Readonly<ViewCheckpoint>) => ViewState<M, K>;
  },
): ComponentType<
  ModuleViewProps<M> & { state: EditableViewState<ViewState<M, K>> }
>;
export function defineView(
  module: ModuleDefinition,
  viewOrComponent: unknown,
  component?: unknown,
  options?: { restore: (checkpoint: Readonly<ViewCheckpoint>) => unknown },
): unknown {
  if (typeof viewOrComponent !== "string") return viewOrComponent;
  const state = module.views?.[viewOrComponent]?.state;
  if (
    !state ||
    !component ||
    (typeof component !== "function" && typeof component !== "object")
  )
    throw Error("Declare this view's editable-state schema before using it.");
  Object.defineProperty(component, "suiteViewState", {
    value: Object.freeze({
      viewId: viewOrComponent,
      version: state.version,
      restore: options?.restore,
    }),
  });
  return component;
}

/** Reject values JSON would silently alter. The host owns an immutable copy. */
export function checkpointValue(schema: TSchema, value: unknown): unknown {
  const visit = (
    value: unknown,
    ancestors: Set<object>,
    depth: number,
  ): void => {
    if (depth > 32) throw Error("Editable state is nested too deeply.");
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean"
    )
      return;
    if (typeof value === "number" && Number.isFinite(value)) return;
    if (
      typeof value !== "object" ||
      !value ||
      ancestors.has(value) ||
      (!Array.isArray(value) &&
        Object.getPrototypeOf(value) !== Object.prototype &&
        Object.getPrototypeOf(value) !== null)
    )
      throw Error("Editable state must contain only JSON values.");
    if (Reflect.ownKeys(value).some((key) => typeof key === "symbol"))
      throw Error("Editable state cannot contain symbol keys.");
    if (
      Array.isArray(value) &&
      (Object.keys(value).length !== value.length ||
        Array.from({ length: value.length }, (_, index) => index).some(
          (index) => !Object.hasOwn(value, index),
        ))
    )
      throw Error(
        "Editable state cannot contain sparse arrays or extra array properties.",
      );
    ancestors.add(value);
    for (const item of Object.values(value)) visit(item, ancestors, depth + 1);
    ancestors.delete(value);
  };
  visit(value, new Set(), 0);
  const text = JSON.stringify(value);
  if (new TextEncoder().encode(text).byteLength > 65536)
    throw Error("Editable state exceeds the 64 KiB limit.");
  const copy: unknown = JSON.parse(text);
  assertSchema(schema, copy);
  const freeze = (value: unknown): unknown => {
    if (value && typeof value === "object") {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  };
  return freeze(copy);
}

/** A version change requires a publisher-supplied conversion, then validation. */
export function restoreViewCheckpoint(
  module: ModuleDefinition,
  viewId: string,
  metadata: ViewStateMetadata,
  checkpoint: ViewCheckpoint | undefined,
): ViewCheckpoint | undefined {
  const target = module.views?.[viewId]?.state;
  if (
    !target ||
    metadata.viewId !== viewId ||
    metadata.version !== target.version
  )
    throw Error(
      "The executable view does not match its editable-state contract.",
    );
  if (!checkpoint) return undefined;
  const same =
    checkpoint.viewId === viewId && checkpoint.version === target.version;
  if (!same && !metadata.restore)
    throw Error(
      "This update cannot convert the current input. Keep the current view or copy the input before discarding it.",
    );
  const value = same
    ? checkpoint.value
    : metadata.restore!(Object.freeze({ ...checkpoint }));
  return Object.freeze({
    viewId,
    version: target.version,
    moduleVersion: module.version,
    value: checkpointValue(target.schema, value),
  });
}

export { viewUIExports, viewReactExports } from "./host-ui";
