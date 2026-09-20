import { OrganizationRoles } from "./roles";
import { PolicyPermissions } from "./permissions";
import { PolicyModules } from "./modules";
import { useRef, useState } from "react";
import type {
  OrganizationPolicy,
  PolicyTag,
} from "@suite/module-sdk/governance";
import { Button, Field, Input, SearchSelect } from "@suite/ui-web";

export function OrganizationTags({
  policy,
  permissions,
  modules,
  canAssignModules,
  disabled,
  onChange,
}: {
  policy: OrganizationPolicy;
  permissions: string[];
  modules: { id: string; name: string }[];
  canAssignModules: boolean;
  disabled: boolean;
  onChange(policy: OrganizationPolicy): void;
}) {
  const addButton = useRef<HTMLButtonElement>(null);
  const [selected, setSelected] = useState("");
  const tags = policy.tags ?? [];
  const tag = tags.find((item) => item.id === selected);
  const update = (value: PolicyTag) =>
    onChange({
      ...policy,
      tags: tags.map((item) => (item.id === value.id ? value : item)),
    });
  return (
    <section
      className="panel organization-section"
      aria-labelledby="role-tags-heading"
    >
      <div className="row-between">
        <h2 id="role-tags-heading">Role tags</h2>
        <Button
          ref={addButton}
          disabled={disabled}
          onClick={() => {
            let name = "New tag",
              index = 2;
            while (
              tags.some((tag) => tag.name.toLowerCase() === name.toLowerCase())
            )
              name = `New tag ${index++}`;
            const value = {
              id: crypto.randomUUID(),
              name,
              rankIds: [],
              grants: [],
              denies: [],
            };
            onChange({ ...policy, tags: [...tags, value] });
            setSelected(value.id);
          }}
        >
          Add role tag
        </Button>
      </div>
      <p>
        Apply shared permissions to selected roles without changing their
        reporting relationships. Changes take effect after saving the
        organization.
      </p>
      {!!tags.length && (
        <Field label="Role tag">
          <SearchSelect
            options={tags.map((item) => ({ value: item.id, label: item.name }))}
            value={selected}
            onValueChange={setSelected}
            disabled={disabled}
            placeholder="Find a role tag"
            clearLabel="Clear role tag selection"
          />
        </Field>
      )}
      {!tags.length && (
        <p className="organization-empty">
          No role tags yet. Add a tag, choose its roles, then set shared
          permissions.
        </p>
      )}
      {tag && (
        <fieldset className="form-stack organization-group" disabled={disabled}>
          <legend>{tag.name}</legend>
          <Field label="Tag name">
            <Input
              maxLength={100}
              value={tag.name}
              onChange={(event) => update({ ...tag, name: event.target.value })}
            />
          </Field>
          <fieldset className="form-stack">
            <legend>Tagged roles</legend>
            <OrganizationRoles
              key={tag.id}
              roles={policy.ranks}
              selected={tag.rankIds}
              disabled={disabled}
              searchLabel="Search tag roles"
              onChange={(rankIds) => update({ ...tag, rankIds })}
            />
          </fieldset>
          <PolicyModules
            modules={modules}
            selected={tag.modules}
            disabled={disabled || !canAssignModules}
            onChange={(modules) => update({ ...tag, modules })}
          />
          <PolicyPermissions
            key={tag.id}
            value={tag}
            kind="Tag"
            permissions={permissions}
            onChange={(decisions) => update({ ...tag, ...decisions })}
          />
          <Button
            onClick={() => {
              onChange({
                ...policy,
                tags: tags.filter((item) => item.id !== tag.id),
              });
              setSelected("");
              addButton.current?.focus();
            }}
          >
            Remove role tag
          </Button>
        </fieldset>
      )}
    </section>
  );
}
