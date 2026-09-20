import { useState } from "react";
import { Checkbox, Pagination, SearchField } from "@suite/ui-web";

/** Keep choices bounded while preserving selections outside the current page. */
export function OrganizationRoles({
  roles,
  selected,
  searchLabel,
  disabled = false,
  onChange,
}: {
  roles: { id: string; name: string }[];
  selected: string[];
  searchLabel: string;
  disabled?: boolean;
  onChange(ids: string[]): void;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const size = 20;
  const matches = roles.filter((role) =>
    role.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(matches.length / size) - 1),
  );
  const offset = currentPage * size;
  const visible = matches.slice(offset, offset + size);
  return (
    <>
      {roles.length > size && (
        <>
          <SearchField
            placeholder={searchLabel}
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(0);
            }}
          />
          <p role="status">
            {selected.length} selected.{" "}
            {matches.length
              ? `Showing ${offset + 1}–${offset + visible.length} of ${matches.length} roles.`
              : "No matching roles."}
          </p>
          <Pagination
            hasPrevious={currentPage > 0}
            next={offset + size < matches.length ? "next" : undefined}
            onPrevious={() => setPage(currentPage - 1)}
            onNext={() => setPage(currentPage + 1)}
            pending={disabled}
          />
        </>
      )}
      <div className="module-toolbar">
        {visible.map((role) => (
          <label key={role.id} className="check-row">
            <Checkbox
              disabled={disabled}
              checked={selected.includes(role.id)}
              onCheckedChange={(checked) =>
                onChange(
                  checked
                    ? [...selected, role.id]
                    : selected.filter((id) => id !== role.id),
                )
              }
            />
            {role.name}
          </label>
        ))}
      </div>
    </>
  );
}
