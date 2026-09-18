export { capability, createModuleHost } from "./contracts/host-capabilities";
export type { ModuleHost, HostCapability } from "./contracts/host-capabilities";
export type {
  ResourceListOptions,
  ResourceOrder,
  ResourceSort,
  ResourceRanges,
  ResourceRangeBounds,
} from "./client/resource-query";
export type {
  StoreQuery,
  StoreFilter,
  StoreAggregate,
} from "./contracts/store-query";
export {
  store,
  type Store,
  type StoreRecord,
  type StorePage,
  type StoreClient,
} from "./authoring/store";
export {
  storageContract,
  localStorageContract,
  supportsStorage,
  type StorageContract,
  type MigrationContext,
} from "./authoring/storage";
export * from "./authoring/module";
export * from "./authoring/validation";
export {
  supportedSchemaFormats,
  type SchemaStringFormat,
} from "./authoring/formats";
export * from "./contracts/resource";
export * from "./client/module-client";
export {
  QueueCaptureError,
  isQueueCaptureError,
} from "./client/queued-operation";
export type {
  ModuleQueue,
  QueueOptions,
  QueuedOperation,
  QueuedOperationName,
  QueuedOperationIdentity,
} from "./client/queued-operation";
export * from "./client/merge";
export * from "./contracts/hydration";
export {
  serviceReference,
  type Configuration,
  type OperationInput,
  type OperationOutput,
  type OperationError,
  type ModuleContext,
  type OperationContext,
  type QueryContext,
} from "./authoring/context";

export { resourceMutationSchema } from "./client/queued-resource";
export type {
  ModuleResourceQueue,
  QueuedResourceIdentity,
  QueuedResource,
  QueuedResourceClient,
  ResourceMutation,
  ResourceMutationInput,
} from "./client/queued-resource";
