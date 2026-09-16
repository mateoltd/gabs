/** A release declares the stored schema versions its code can safely read and write. */
export interface StorageContract {
  version: number;
  compatible: { minimum: number; maximum: number };
  migrations: Record<string, { from: number; to: number }>;
}
export function storageContract(module: {
  storage?: StorageContract;
}): StorageContract {
  return (
    module.storage ?? {
      version: 1,
      compatible: { minimum: 1, maximum: 1 },
      migrations: {},
    }
  );
}
export function validateStorageContract(contract: StorageContract) {
  const positive = (n: number) => Number.isSafeInteger(n) && n > 0;
  if (
    !positive(contract.version) ||
    !positive(contract.compatible.minimum) ||
    !positive(contract.compatible.maximum) ||
    contract.compatible.minimum > contract.version ||
    contract.compatible.maximum < contract.version
  )
    throw Error(
      "Storage versions must be positive integers and the compatibility range must include the release schema version.",
    );
  const from = new Set<number>();
  for (const [name, step] of Object.entries(contract.migrations)) {
    if (
      !/^[a-z][a-z0-9-]{0,63}$/.test(name) ||
      !positive(step.from) ||
      step.to !== step.from + 1 ||
      step.to > contract.version ||
      from.has(step.from)
    )
      throw Error(`Invalid or ambiguous forward migration: ${name}`);
    from.add(step.from);
  }
}
export function supportsStorage(
  module: { storage?: StorageContract },
  version: number,
) {
  const { compatible } = storageContract(module);
  return compatible.minimum <= version && version <= compatible.maximum;
}
export interface MigrationRecord {
  id: string;
  resource: string;
  data: Record<string, unknown>;
  version: number;
  archived: boolean;
}
/** Historical data is unknown until the migration validates its source schema. */
export interface MigrationContext {
  readonly workspaceId: string;
  readonly from: number;
  readonly to: number;
  scan(
    resource: string,
    after?: string,
  ): Promise<{ items: MigrationRecord[]; next: string | null }>;
  create(
    resource: string,
    data: Record<string, unknown>,
    id?: string,
  ): Promise<MigrationRecord>;
  archive(resource: string, id: string, expectedVersion: number): Promise<void>;
  write(
    resource: string,
    id: string,
    data: Record<string, unknown>,
    expectedVersion: number,
  ): Promise<void>;
}
export type MigrationHandler = (context: MigrationContext) => Promise<void>;
