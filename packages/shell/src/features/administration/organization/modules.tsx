import { Checkbox } from "@suite/ui-web";

export function PolicyModules({
  modules,
  selected = [],
  disabled,
  onChange,
}: {
  modules: { id: string; name: string }[];
  selected?: string[];
  disabled: boolean;
  onChange(modules: string[]): void;
}) {
  const choices = [
    ...modules,
    ...selected
      .filter((id) => !modules.some((m) => m.id === id))
      .map((id) => ({ id, name: id })),
  ];
  return (
    <fieldset className="form-stack" disabled={disabled}>
      <legend>Assigned modules</legend>
      <p>
        Members of these roles receive the selected modules and their
        dependencies. Access requires available seats, an active license and
        publication. Changes take effect after saving the organization.
      </p>
      <div className="module-toolbar">
        {choices.map((module) => (
          <label key={module.id} className="check-row">
            <Checkbox
              checked={selected.includes(module.id)}
              onCheckedChange={(checked) =>
                onChange(
                  checked
                    ? [...selected, module.id]
                    : selected.filter((id) => id !== module.id),
                )
              }
            />
            {module.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
