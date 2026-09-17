import { type FeatureProps } from "@suite/client";
import {
  Button,
  Checkbox,
  ErrorMessage,
  Field,
  fieldLabel,
  Input,
  Select,
  SelectOption,
} from "@suite/ui-web";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useShellComposition } from "../../app/composition";
import { usePlatformState } from "./module-lifecycle";
const archetypes = [
  "modern-dark",
  "chromatic-playful",
  "executive-serious",
  "classic-retro",
  "neumorphic-soft",
  "minimal-clean",
  "industrial-technical",
  "glassmorphic-luxe",
  "editorial-paper",
  "material-expressive",
];
export function Appearance(props: FeatureProps) {
  const state = usePlatformState(props);
  const [error, setError] = useState<unknown>();
  const [saving, setSaving] = useState(false);
  const setting = state.data?.settings.find((s) => s.key === "appearance");
  const current = String(setting?.value.archetype ?? "modern-dark");
  return (
    <section className="panel">
      <h2>Workspace appearance</h2>
      <Field label="Design archetype">
        <Select
          value={current}
          disabled={
            saving || !props.bootstrap.permissions.includes("workspace.manage")
          }
          onValueChange={async (archetype) => {
            if (saving || archetype === current) return;
            setSaving(true);
            setError(undefined);
            try {
              await props.client.request({
                operation: "platformCommand",
                params: { workspaceId: props.scope.workspaceId },
                body: {
                  action: "appearance",
                  value: { archetype },
                  version: setting?.version ?? 0,
                },
                idempotencyKey: crypto.randomUUID(),
              });
              await state.refetch();
            } catch (e) {
              setError(e);
            } finally {
              setSaving(false);
            }
          }}
        >
          {archetypes.map((a) => (
            <SelectOption key={a} value={a}>
              {fieldLabel(a)}
            </SelectOption>
          ))}
        </Select>
      </Field>
      <ErrorMessage error={error} />
    </section>
  );
}
export function Billing(props: FeatureProps) {
  const { catalog } = useShellComposition();
  const state = useQuery({
    queryKey: [props.scope.userId, props.scope.workspaceId, "billing"],
    enabled:
      props.online && props.bootstrap.permissions.includes("billing.manage"),
    queryFn: () =>
      props.client.request({
        operation: "billingState",
        params: { workspaceId: props.scope.workspaceId },
      }),
  });
  const [modules, setModules] = useState<string[]>([]),
    [seats, setSeats] = useState(props.bootstrap.seatLimit),
    [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false);
  if (!props.bootstrap.permissions.includes("billing.manage")) return null;
  async function act(action: "checkout" | "portal" | "reconcile") {
    setBusy(true);
    try {
      const result = await props.client.request({
        operation: "billingCommand",
        params: { workspaceId: props.scope.workspaceId },
        body: { action, modules, seats },
        idempotencyKey: crypto.randomUUID(),
      });
      if (result.url) {
        const url = new URL(result.url);
        if (
          url.protocol !== "https:" ||
          !["checkout.stripe.com", "billing.stripe.com"].includes(url.hostname)
        )
          throw Error("Unexpected billing destination.");
        if (window.suiteDesktop)
          await window.suiteDesktop.openBilling(url.href);
        else window.location.assign(url.href);
      }
      await state.refetch();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>Billing and licenses</h2>
      <ErrorMessage error={error ?? state.error} />
      {state.data?.configured ? (
        <>
          <p>Subscription: {state.data.status}</p>
          <Field label="Seats">
            <Input
              type="number"
              min="1"
              max="100000"
              value={seats}
              onChange={(e) => setSeats(Number(e.target.value))}
            />
          </Field>
          {state.data.modules.map((id) => (
            <label key={id} className="check-row">
              <Checkbox
                checked={modules.includes(id)}
                onCheckedChange={(checked) =>
                  setModules(
                    checked
                      ? [...modules, id]
                      : modules.filter((m) => m !== id),
                  )
                }
              />
              {catalog.definition(id)?.name ?? id}
            </label>
          ))}
          <div className="module-toolbar">
            <Button
              disabled={busy || state.data.subscribed || !modules.length}
              onClick={() => void act("checkout")}
            >
              Purchase subscription
            </Button>
            <Button
              disabled={busy || !state.data.subscribed}
              onClick={() => void act("portal")}
            >
              Manage subscription
            </Button>
            <Button
              disabled={busy || !state.data.subscribed}
              onClick={() => void act("reconcile")}
            >
              Refresh entitlements
            </Button>
          </div>
          <p>
            Access changes after the payment provider confirms your
            subscription.
          </p>
        </>
      ) : (
        <p>
          Billing is unavailable until this deployment connects its payment
          provider and module prices.
        </p>
      )}
    </section>
  );
}
export function LocalNetwork(props: FeatureProps) {
  const native = window.suiteDesktop;
  const state = useQuery({
    queryKey: [props.scope.userId, props.scope.workspaceId, "lan"],
    enabled: !!native,
    queryFn: () => native!.lanStatus(),
    refetchInterval: 15000,
  });
  const [error, setError] = useState<unknown>(),
    [busy, setBusy] = useState(false);
  if (!native || !props.bootstrap.permissions.includes("modules.manage"))
    return null;
  return (
    <section className="panel">
      <h2>Local network</h2>
      <p>
        {state.data?.configured
          ? "Exchange authorized packages and pending changes with managed devices. Business changes still need server acceptance."
          : "Managed device certificates and a peer policy are required before local networking can be enabled."}
      </p>
      <p>
        {state.data?.enabled
          ? `${state.data.peers.length} peers connected`
          : "Disabled"}
      </p>
      <Button
        disabled={busy || !state.data?.configured}
        onClick={async () => {
          setBusy(true);
          try {
            await native.setLan(props.scope, !state.data?.enabled);
            await state.refetch();
          } catch (e) {
            setError(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        {state.data?.enabled ? "Disable local network" : "Enable local network"}
      </Button>
      <ErrorMessage error={error} />
    </section>
  );
}
