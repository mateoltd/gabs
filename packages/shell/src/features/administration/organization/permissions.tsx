import { useState } from "react";
import type { PolicyTag } from "@suite/module-sdk/governance";
import { Field, Select, SelectOption } from "@suite/ui-web";

export function PolicyPermissions({
  value,
  kind,
  permissions,
  onChange,
}: {
  value: Pick<PolicyTag, "grants" | "denies">;
  kind: "Group" | "Tag";
  permissions: string[];
  onChange(value: Pick<PolicyTag, "grants" | "denies">): void;
}) {
  const [permission, setPermission] = useState("");
  const decisions = [...new Set([...value.grants, ...value.denies])].sort();
  const choice = (permission: string) =>
    value.denies.includes(permission)
      ? "deny"
      : value.grants.includes(permission)
        ? "grant"
        : "none";
  const set = (permission: string, effect: string) =>
    onChange({
      grants: [
        ...value.grants.filter((item) => item !== permission),
        ...(effect === "grant" ? [permission] : []),
      ],
      denies: [
        ...value.denies.filter((item) => item !== permission),
        ...(effect === "deny" ? [permission] : []),
      ],
    });
  return (
    <>
      <Field label={`${kind} permission`}>
        <Select value={permission} onValueChange={setPermission}>
          <SelectOption value="">Choose a permission</SelectOption>
          {[...new Set([...permissions, ...decisions])].map((value) => (
            <SelectOption value={value} key={value}>
              {value}
            </SelectOption>
          ))}
        </Select>
      </Field>
      {permission && (
        <Field label={`Policy for ${permission}`}>
          <Select
            value={choice(permission)}
            onValueChange={(effect) => set(permission, effect)}
          >
            <SelectOption value="none">Not set</SelectOption>
            <SelectOption value="grant">Allow</SelectOption>
            <SelectOption value="deny">Deny</SelectOption>
          </Select>
        </Field>
      )}
      <div aria-live="polite">
        {!decisions.length ? (
          <p>No permissions set on this {kind.toLowerCase()}.</p>
        ) : (
          <ul>
            {decisions.map((permission) => (
              <li key={permission}>
                {value.denies.includes(permission) ? "Deny" : "Allow"}{" "}
                {permission}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
