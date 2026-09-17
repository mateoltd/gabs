import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@suite/client/api";
import type {
  BusinessCutoverSelection,
  BusinessCutoverReview,
  BusinessCutoverCommand,
} from "@suite/contracts";
import type { FeatureProps } from "@suite/client";
import type { PlatformState } from "@suite/module-sdk/platform";
import { storageContract } from "@suite/module-sdk";
import {
  compareVersions,
  type ReleaseManifest,
} from "@suite/module-sdk/registry";
import {
  Button,
  Checkbox,
  ErrorMessage,
  Field,
  Modal,
  Select,
  SelectOption,
  Table,
} from "@suite/ui-web";
const ids = ["inventory", "orders"] as const;

export function BusinessCutover(
  props: FeatureProps & { state: PlatformState },
) {
  const qc = useQueryClient();
  const choices = (id: string) =>
    props.state.releases
      .filter(
        (r) =>
          r.module_id === id &&
          storageContract(r.manifest as unknown as ReleaseManifest).version ===
            2,
      )
      .sort((a, b) => compareVersions(b.version, a.version));
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<BusinessCutoverSelection>({
    inventory: "",
    orders: "",
    roleGrants: [],
    grantServices: false,
  });
  const [review, setReview] = useState<BusinessCutoverReview>();
  const [attempt, setAttempt] = useState<{
    key: string;
    value: BusinessCutoverCommand;
  }>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    [done, setDone] = useState(false);
  const completed =
    done ||
    props.state.settings.some(
      (s) =>
        s.key === "business-storage-import" && s.value.state === "completed",
    );
  const canStart = ids.every(
    (id) =>
      (props.state.storage?.find((s) => s.module_id === id)?.schema_version ??
        1) === 1 && choices(id).length > 0,
  );
  if (!canStart && !completed) return null;
  const additions = [
    ...new Set(
      ids.flatMap((id) => {
        const manifest = choices(id).find((r) => r.version === selection[id])
          ?.manifest as unknown as ReleaseManifest | undefined;
        return (manifest?.permissions ?? []).filter(
          (p) =>
            !props.state.modules
              .find((m) => m.id === id)
              ?.permissions.includes(p),
        );
      }),
    ),
  ];
  const change = (next: BusinessCutoverSelection) => {
    setSelection(next);
    setReview(undefined);
    setError(undefined);
  };
  const refresh = () =>
    qc.invalidateQueries({
      queryKey: [props.scope.userId, props.scope.workspaceId],
    });
  const reviewSelection = async () => {
    setBusy(true);
    setError(undefined);
    setReview(undefined);
    try {
      setReview(
        await props.client.request({
          operation: "businessCutoverReview",
          params: { workspaceId: props.scope.workspaceId },
          body: selection,
        }),
      );
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const apply = async () => {
    if (!attempt && !review?.ready) return;
    const current = attempt ?? {
      key: crypto.randomUUID(),
      value: { ...selection, reviewToken: review!.token },
    };
    setAttempt(current);
    setBusy(true);
    setError(undefined);
    try {
      await props.client.request({
        operation: "platformCommand",
        params: { workspaceId: props.scope.workspaceId },
        idempotencyKey: current.key,
        body: { action: "business-cutover", value: current.value },
      });
      setDone(true);
      setAttempt(undefined);
      await refresh();
    } catch (e) {
      setError(e);
      // An uncertain response retains the exact reviewed command and receipt key.
      if (
        e instanceof ApiError &&
        e.status < 500 &&
        e.status !== 408 &&
        e.status !== 429
      ) {
        setAttempt(undefined);
        setReview(undefined);
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button disabled={!props.online} onClick={() => setOpen(true)}>
        {completed ? "Business upgrade details" : "Upgrade business modules"}
      </Button>
      <Modal
        wide
        open={open}
        onOpenChange={(v) => {
          if (!busy || completed) setOpen(v);
        }}
        title="Upgrade Orders and Inventory"
        description="Review access and move both business modules together."
      >
        <div className="form-stack">
          <ErrorMessage error={error} />
          {completed ? (
            <>
              <p role="status">
                Orders and Inventory have completed their coordinated upgrade.
              </p>
              <p>
                Business history is preserved. Devices must install the selected
                releases before continuing corporate work. Review device
                progress from each module.
              </p>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </>
          ) : (
            <>
              <p>
                This forward migration preserves business records and source
                history. Both releases become mandatory. Older clients must
                update; disconnected devices may retain cached access until
                their current offline lease expires.
              </p>
              {ids.map((id) => (
                <Field
                  key={id}
                  label={`${id === "orders" ? "Orders" : "Inventory"} upgrade release`}
                >
                  <Select
                    value={selection[id]}
                    disabled={busy || !!attempt}
                    onValueChange={(v) =>
                      change({ ...selection, [id]: v ?? "", roleGrants: [] })
                    }
                  >
                    {choices(id).map((r) => (
                      <SelectOption key={r.version} value={r.version}>
                        {r.version}
                      </SelectOption>
                    ))}
                  </Select>
                </Field>
              ))}
              {!!additions.length && (
                <section
                  className="form-stack"
                  aria-label="Upgrade role permissions"
                >
                  <h3>New role permissions</h3>
                  <p>
                    Choose which roles receive the new permissions. Existing
                    grants remain in place, and explicit denials still apply.
                    The review checks whether assigned people can continue their
                    current business actions.
                  </p>
                  <div className="table-wrap">
                    <Table aria-label="Upgrade role permissions">
                      <thead>
                        <tr>
                          <th>Role</th>
                          {additions.map((p) => (
                            <th key={p}>{p}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {props.state.roles.map((role) => (
                          <tr key={role.id}>
                            <th scope="row">{role.name}</th>
                            {additions.map((p) => (
                              <td key={p}>
                                <Checkbox
                                  aria-label={`${role.name}: ${p}`}
                                  checked={
                                    role.permissions.includes(p) ||
                                    !!selection.roleGrants
                                      .find((g) => g.roleId === role.id)
                                      ?.permissions.includes(p)
                                  }
                                  disabled={
                                    busy ||
                                    !!attempt ||
                                    role.permissions.includes(p) ||
                                    !props.bootstrap.permissions.includes(
                                      "roles.manage",
                                    )
                                  }
                                  onCheckedChange={(checked) => {
                                    const existing =
                                      selection.roleGrants.find(
                                        (g) => g.roleId === role.id,
                                      )?.permissions ?? [];
                                    change({
                                      ...selection,
                                      roleGrants: [
                                        ...selection.roleGrants.filter(
                                          (g) => g.roleId !== role.id,
                                        ),
                                        {
                                          roleId: role.id,
                                          permissions: checked
                                            ? [...existing, p]
                                            : existing.filter(
                                                (value) => value !== p,
                                              ),
                                        },
                                      ].filter((g) => g.permissions.length),
                                    });
                                  }}
                                />
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  </div>
                </section>
              )}
              <Field label="Grant Orders access to Inventory services">
                <Checkbox
                  checked={selection.grantServices}
                  disabled={busy || !!attempt}
                  onCheckedChange={(checked) =>
                    change({ ...selection, grantServices: !!checked })
                  }
                />
              </Field>
              <p>
                Allows product lookup, reservation, release and consumption
                through declared services. Each action still checks the person’s
                current permissions and business rules.
              </p>
              {attempt && (
                <p role="status">
                  The outcome has not been confirmed. Retry the same upgrade to
                  recover its result safely. Reopening this page also checks the
                  server’s completion record.
                </p>
              )}
              {!attempt && (
                <Button
                  disabled={
                    busy ||
                    !props.online ||
                    !selection.inventory ||
                    !selection.orders
                  }
                  onClick={() => void reviewSelection()}
                >
                  {busy ? "Reviewing upgrade…" : "Review upgrade"}
                </Button>
              )}
              {review && (
                <section
                  className="form-stack"
                  aria-label="Business upgrade review"
                >
                  <h3>
                    {review.ready
                      ? "Ready to upgrade"
                      : "Resolve before upgrading"}
                  </h3>
                  <p>
                    {review.counts.products}{" "}
                    {review.counts.products === 1 ? "product" : "products"},{" "}
                    {review.counts.orders}{" "}
                    {review.counts.orders === 1 ? "order" : "orders"} and{" "}
                    {review.counts.movements}{" "}
                    {review.counts.movements === 1
                      ? "stock movement"
                      : "stock movements"}{" "}
                    at review time. Records are validated again when applying
                    the upgrade.
                  </p>
                  {review.releases.map((r) => (
                    <p className="small" key={r.moduleId}>
                      {r.moduleId} {r.version}
                      <br />
                      Package checksum:{" "}
                      <code style={{ overflowWrap: "anywhere" }}>
                        {r.digest}
                      </code>
                    </p>
                  ))}
                  {!!review.issues.length && (
                    <ul>
                      {review.issues.map((i, index) => (
                        <li key={index}>{i.message}</li>
                      ))}
                    </ul>
                  )}
                  {!!review.restrictedCount && (
                    <>
                      <p>
                        {review.restrictedCount} people need an access review.
                        Showing {review.restrictedMembers.length}.
                      </p>
                      <ul>
                        {review.restrictedMembers.map((m) => (
                          <li key={m.id}>
                            {m.name}: {m.missing.join(", ")}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {review.ready && (
                    <p>
                      Selected permissions, service grants and both migrations
                      will commit together. If any step fails, none of these
                      changes are applied.
                    </p>
                  )}
                </section>
              )}
              {(review?.ready || attempt) && (
                <Button
                  variant="primary"
                  disabled={busy || !props.online}
                  onClick={() => void apply()}
                >
                  {busy
                    ? "Applying upgrade…"
                    : attempt
                      ? "Retry upgrade"
                      : "Apply reviewed upgrade"}
                </Button>
              )}
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
