# Developing standalone device workflows

Use the public simulator to test local handlers and queued device effects without opening file dialogs, showing notifications or contacting peers.

```ts
import { createModuleSimulator } from "@suite/module-sdk/simulator";
import module from "./module";
import local from "./module-local";

const simulation = createModuleSimulator(module, {
  personal: true,
  local,
  deviceAccess: ["export"],
  hostResults: { export: { status: "cancelled" } },
});
simulation.setOnline(false);
const requestId = await simulation.localClient.call("capture", {
  text: "Notes",
});
await simulation.processDeviceRequest(requestId);
```

Replace `capture` and `export` with your module's declarations. Their inputs, aliases and results are inferred. `localClient` only exposes standalone resources and local operations. Handlers run through the actual local transaction engine. Missing consent rolls back the transaction; replaying a receipt never adds another device request.

For the CLI and browser preview, export `defineSimulationModule(module, { personal: true, deviceAccess: ["export"], hostResults: { ... } })` from `module.simulation.ts`. The loader discovers `module-local.ts` automatically. Author `defineModuleScenarios` in `module.scenarios.ts` and run `pnpm module test <directory>`, or use `pnpm module dev <directory>` for the interactive controls. Source changes reset development state.

## Consent and outcomes

- `setDeviceAccess(alias, allowed)` changes root-module consent. Revoking and regranting creates a new grant identity; old requests need an explicit retry.
- `setModuleDeviceAccess(moduleId, alias, allowed)` configures a loaded provider. Declared service access does not substitute for that provider's device consent. Use the normal `providers`, `grants` and `readGrants` fixtures for cross-module work.
- `setHostResult(alias, result)` configures a typed root result. `setModuleHostResult(moduleId, alias, result)` configures a provider with runtime validation. Passing `undefined` restores defaults; relay requires an explicit result.
- `processDeviceRequest(id)` validates current consent and stores a simulated result. Repeating a completed request returns its saved result.
- `processDeviceRequest(id, { interrupt: true })` leaves a simulated running request without an outcome. `lockProfile()` and `unlockProfile()` recover it as uncertain. Nothing is replayed automatically.
- `retryDeviceRequest(id, { confirmUncertain: true })` creates a linked pending request after review. Rejected requests do not require uncertain-outcome acknowledgement. Process the returned ID separately; the business operation is not repeated.
- `dismissDeviceRequest(id)` clears an inactive request while preserving records. Inspect `snapshot().local` for grants, requests, outcomes and configured results.

The preview offers these controls with explicit simulated-state labels. Corporate direct `host.call` remains online-only; standalone handlers use `ctx.device.request` and subsequent simulated processing.

These development scenarios do not verify durable storage, signed packages, native presentation or real LAN behavior. Use the separate [production-path acceptance evidence](verification/local-device-effects/README.md) and [simulation verification](verification/local-device-simulator/README.md) to distinguish those scopes.
