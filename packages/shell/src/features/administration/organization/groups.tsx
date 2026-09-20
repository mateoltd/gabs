import { useRef, useState } from "react";
import type {
  OrganizationPolicy,
  PolicyGroup,
} from "@suite/module-sdk/governance";
import { Button, Checkbox, Field, Input, SearchSelect } from "@suite/ui-web";
import { PolicyModules } from "./modules";
import { PolicyPermissions } from "./permissions";

export function OrganizationGroups({
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
  const [selected, setSelected] = useState(policy.groups[0]?.id ?? "");
  const group = policy.groups.find((item) => item.id === selected);
  const update = (value: PolicyGroup) =>
    onChange({
      ...policy,
      groups: policy.groups.map((item) =>
        item.id === value.id ? value : item,
      ),
    });
  return (
    <section
      className="panel organization-section"
      aria-labelledby="groups-heading"
    >
      <div className="row-between">
        <h2 id="groups-heading">Groups</h2>
        <Button
          ref={addButton}
          disabled={disabled}
          onClick={() => {
            let name = "New group",
              index = 2;
            while (
              policy.groups.some(
                (item) => item.name.toLowerCase() === name.toLowerCase(),
              )
            )
              name = `New group ${index++}`;
            const value: PolicyGroup = {
              id: crypto.randomUUID(),
              name,
              rankIds: [],
              tags: [],
              grants: [],
              denies: [],
            };
            onChange({ ...policy, groups: [...policy.groups, value] });
            setSelected(value.id);
          }}
        >
          Add group
        </Button>
      </div>
      <p>
        Apply shared permissions and module policies to selected roles. Changes
        take effect after saving the organization.
      </p>
      {!!policy.groups.length && (
        <Field label="Group">
          <SearchSelect
            options={policy.groups.map((item) => ({
              value: item.id,
              label: item.name,
            }))}
            value={selected}
            onValueChange={setSelected}
            disabled={disabled}
            placeholder="Find a group"
            clearLabel="Clear group selection"
          />
        </Field>
      )}
      {!policy.groups.length && (
        <p className="organization-empty">
          No groups yet. Group roles to apply shared permissions and labels.
        </p>
      )}
      {group && (
        <fieldset className="form-stack organization-group" disabled={disabled}>
          <legend>{group.name}</legend>
          <Field label="Group name">
            <Input
              maxLength={100}
              value={group.name}
              onChange={(event) =>
                update({ ...group, name: event.target.value })
              }
            />
          </Field>
          <Field label="Group labels (comma separated)">
            <Input
              value={group.tags.join(", ")}
              onChange={(event) =>
                update({
                  ...group,
                  tags: event.target.value
                    .split(",")
                    .map((value) => value.trim()),
                })
              }
            />
          </Field>
          <fieldset className="form-stack">
            <legend>Grouped roles</legend>
            <div className="module-toolbar">
              {policy.ranks.map((rank) => (
                <label key={rank.id} className="check-row">
                  <Checkbox
                    checked={group.rankIds.includes(rank.id)}
                    onCheckedChange={(checked) =>
                      update({
                        ...group,
                        rankIds: checked
                          ? [...group.rankIds, rank.id]
                          : group.rankIds.filter((id) => id !== rank.id),
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
            selected={group.modules}
            disabled={disabled || !canAssignModules}
            onChange={(modules) => update({ ...group, modules })}
          />
          <PolicyPermissions
            key={group.id}
            value={group}
            kind="Group"
            permissions={permissions}
            onChange={(decisions) => update({ ...group, ...decisions })}
          />
          <Button
            onClick={() => {
              onChange({
                ...policy,
                groups: policy.groups.filter((item) => item.id !== group.id),
              });
              setSelected("");
              addButton.current?.focus();
            }}
          >
            Remove group
          </Button>
        </fieldset>
      )}
    </section>
  );
}
