import type { JournalEntry } from "@suite/module-sdk/sync";

export function CreateRecoveryNotice({ context }: { context?: JournalEntry["createRecovery"] }) {
  if (!context?.length) return null;
  return (
    <div role="status">
      <p>
        A prerequisite record was replaced. Review which references should use
        the separate record. Original request input is unchanged.
      </p>
      <ul>
        {context.map((recovery) => (
          <li key={`${recovery.moduleId}/${recovery.resource}/${recovery.originalId}`}>
            <p>{recovery.moduleId}: {recovery.resource}</p>
            <p>Original record: {recovery.originalId}</p>
            <p>Separate record: {recovery.replacementId}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
