import { PolicyModules } from "./modules";
import { useRef, useState } from "react";
import type {
  OrganizationPolicy,
  PolicyTag,
} from "@suite/module-sdk/governance";
import {
  Button,
  Checkbox,
  Field,
  Input,
  Select,
  SelectOption,
  SearchSelect,
} from "@suite/ui-web";

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
            <div className="module-toolbar">
              {policy.ranks.map((rank) => (
                <label key={rank.id} className="check-row">
                  <Checkbox
                    checked={tag.rankIds.includes(rank.id)}
                    onCheckedChange={(checked) =>
                      update({
                        ...tag,
                        rankIds: checked
                          ? [...tag.rankIds, rank.id]
                          : tag.rankIds.filter((id) => id !== rank.id),
                      })
                    }
                  />
                  {rank.name}
                </label>
              ))}
            </div>
          </fieldset>
          <PolicyModules
            modules={modules}
            selected={tag.modules}
            disabled={disabled || !canAssignModules}
            onChange={(modules) => update({ ...tag, modules })}
          />
          <TagPermissions
            key={tag.id}
            tag={tag}
            permissions={permissions}
            onChange={update}
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
function TagPermissions({
  tag,
  permissions,
  onChange,
}: {
  tag: PolicyTag;
  permissions: string[];
  onChange(tag: PolicyTag): void;
}) {
  const [permission, setPermission] = useState("");
  const decisions = [...new Set([...tag.grants, ...tag.denies])].sort();
  const choice = (value: string) =>
    tag.denies.includes(value)
      ? "deny"
      : tag.grants.includes(value)
        ? "grant"
        : "none";
  const set = (value: string, effect: string) =>
    onChange({
      ...tag,
      grants: [
        ...tag.grants.filter((item) => item !== value),
        ...(effect === "grant" ? [value] : []),
      ],
      denies: [
        ...tag.denies.filter((item) => item !== value),
        ...(effect === "deny" ? [value] : []),
      ],
    });
  return (
    <>
      <Field label="Tag permission">
        <Select value={permission} onValueChange={setPermission}>
          <SelectOption value="">Choose a permission</SelectOption>
          {permissions.map((value) => (
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
          <p>No permissions set on this tag.</p>
        ) : (
          <ul>
            {decisions.map((value) => (
              <li key={value}>
                {tag.denies.includes(value) ? "Deny" : "Allow"} {value}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
