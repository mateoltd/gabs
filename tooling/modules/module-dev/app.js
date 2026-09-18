import { updatePreview, hidePreview, referenceFields } from "/preview.js";
const $ = (id) => document.getElementById(id);
let state, revision, buildStatus;
let requestSequence = 0,
  appliedSequence = 0;
const text = (tag, value) => {
  const element = document.createElement(tag);
  element.textContent = value;
  return element;
};
async function request(body, options = {}) {
  const sequence = ++requestSequence;
  options.signal?.throwIfAborted();
  const response = await fetch("/action", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-module-dev-revision": revision,
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });
  const data = await response.json();
  options.signal?.throwIfAborted();
  const snapshot = response.ok ? data : data.simulation;
  // An older read must not restore permissions or other controls from its snapshot.
  if (snapshot && sequence >= appliedSequence) {
    appliedSequence = sequence;
    state = { ...state, ...snapshot };
    renderState();
  }
  if (!response.ok) throw Object.assign(Error(data.message), data);
  return data;
}
function feedback(message) {
  $("feedback").textContent = message;
}
function table(rows, label) {
  if (!rows.length) return text("p", "No entries.");
  const table = document.createElement("table"),
    head = document.createElement("tr");
  const keys = Object.keys(rows[0]);
  if (keys.length > 4) table.style.minWidth = `${keys.length * 160}px`;
  keys.forEach((key) => head.append(text("th", key)));
  table.append(head);
  for (const row of rows) {
    const tr = document.createElement("tr");
    keys.forEach((key) =>
      tr.append(
        text(
          "td",
          typeof row[key] === "object"
            ? JSON.stringify(row[key])
            : String(row[key] ?? ""),
        ),
      ),
    );
    table.append(tr);
  }
  const scroll = document.createElement("div");
  scroll.className = "table-scroll";
  scroll.tabIndex = 0;
  scroll.setAttribute("role", "region");
  scroll.setAttribute("aria-label", label);
  scroll.append(table);
  return scroll;
}
function renderState() {
  $("online").checked = state.online;
  renderLocal();
  renderLeases();
  $("records").replaceChildren(
    ...Object.entries(state.records).flatMap(([name, rows]) => [
      text("h3", name),
      table(
        rows.map((r) => ({ id: r.id, ...r.data, version: r.version })),
        `${name} records`,
      ),
    ]),
  );
  if (!Object.keys(state.records).length)
    $("records").append(text("p", "No resources declared."));
  $("journal").replaceChildren(
    table(
      state.journal.map((e) => ({
        id: e.id,
        state: e.state,
        attempts: e.attempts,
        error: e.error ?? "",
      })),
      "Operation journal data",
    ),
  );
  $("events").textContent = JSON.stringify(state.events, null, 2);
  $("audits").replaceChildren(table(state.audits, "Simulated audit entries"));
  $("host-actions").replaceChildren(
    table(
      state.hostActions.map((action) => ({
        capability: action.capability,
        state: action.authority
          ? `${action.state} (${action.authority})`
          : action.state,
        result: action.result ?? "",
        error: action.error ?? "",
      })),
      "Simulated host actions",
    ),
  );
  const collections = (data, scope) =>
    Object.entries(data).flatMap(([name, rows]) => [
      text("h3", name),
      table(
        rows.map((row) => ({
          id: row.id,
          ...row.data,
          version: row.version,
          archived: row.archived,
        })),
        `${scope} ${name} data`,
      ),
    ]);
  $("store-section").hidden = !Object.keys(state.stores).length;
  $("stores").replaceChildren(...collections(state.stores, state.module.id));
  $("provider-section").hidden = !Object.keys(state.providers).length;
  $("providers").replaceChildren(
    ...Object.entries(state.providers).map(([id, provider]) => {
      const section = document.createElement("section");
      section.append(
        text("h3", `${provider.module.name} ${provider.module.version}`),
        ...collections(provider.records, id),
        ...collections(provider.stores, id),
      );
      return section;
    }),
  );
  updatePreview(
    state,
    async (call, options) =>
      (await request({ action: "execute", call }, options)).result,
    async (call) => (await request({ action: "host", call })).result,
    {
      capture: async (call, dependencies) =>
        (await request({ action: "queue", call, dependencies })).result,
      get: async (identity) =>
        (await request({ action: "queued", identity })).result,
    },
  );
}
function hostResult() {
  renderLeases();
  const [moduleId, capability] = hostSelection();
  $("host-result").value = JSON.stringify(
    (state.local?.hostResults[moduleId] ?? state.hostResults)[capability] ??
      null,
    null,
    2,
  );
}
function renderLeases() {
  const [, capability] = hostSelection();
  const lease = state.hostLeases[capability];
  $("lease-controls").hidden = !!state.local || !lease;
  if (!lease) return;
  const remaining = Math.ceil(lease.remainingMs / 60000);
  $("lease-status").textContent =
    `${capability}: ${lease.state}. ${remaining} ${remaining === 1 ? "minute" : "minutes"} remaining. Simulated clock advanced ${state.hostElapsedMs / 60000} minutes.`;
  $("lease-renew").disabled = !state.online;
}
for (const [id, task] of [
  ["lease-renew", "renew"],
  ["lease-revoke", "revoke"],
  ["lease-clock", "clock"],
]) {
  $(id).onclick = async () => {
    try {
      const [, capability] = hostSelection();
      const minutes = Number(
        $(task === "clock" ? "lease-advance" : "lease-minutes").value,
      );
      if (
        task !== "revoke" &&
        (!Number.isSafeInteger(minutes) ||
          minutes < 0 ||
          (task === "renew" && minutes > 1440))
      )
        throw Error(
          "Enter a whole number of minutes; leases may last at most 1440 minutes.",
        );
      await request(
        task === "clock"
          ? { action: "hostClock", milliseconds: minutes * 60000 }
          : {
              action: "hostLease",
              capability,
              task,
              ...(task === "renew" ? { remainingMs: minutes * 60000 } : {}),
            },
      );
      $("lease-feedback").textContent =
        "Simulated lease state updated. No device action was performed.";
    } catch (error) {
      $("lease-feedback").textContent = error.message;
    }
  };
}
function hostSelection() {
  const value = $("host-capability").value;
  return value.includes("/") ? value.split("/") : [state.module.id, value];
}
$("host-capability").onchange = hostResult;
$("host-form").onsubmit = async (event) => {
  event.preventDefault();
  try {
    const [moduleId, capability] = hostSelection();
    await request({
      action: "hostResult",
      moduleId,
      capability,
      result: JSON.parse($("host-result").value),
    });
    hostResult();
    $("host-feedback").textContent =
      "Simulated result updated. No device action was performed.";
  } catch (error) {
    $("host-feedback").textContent = error.message;
  }
};
function renderLocal() {
  $("local-controls").hidden = !state.local;
  if (!state.local) return;
  const local = state.local;
  $("local-profile").textContent = local.locked
    ? "Simulated profile locked."
    : "Simulated profile unlocked.";
  $("local-lock").textContent = local.locked
    ? "Unlock and recover simulated profile"
    : "Lock simulated profile";
  for (const input of $("local-access").querySelectorAll("input")) {
    input.checked = local.deviceGrants.some(
      (g) =>
        g.moduleId === input.dataset.module &&
        g.capability === input.dataset.capability,
    );
    input.disabled = local.locked;
  }
  const selection = $("local-request").value;
  $("local-request").replaceChildren(
    ...local.deviceRequests.map((r) => {
      const option = text(
        "option",
        `${r.call.moduleId}: ${r.call.capability} (${r.state})`,
      );
      option.value = r.id;
      return option;
    }),
  );
  if (local.deviceRequests.some((r) => r.id === selection))
    $("local-request").value = selection;
  else $("local-review").checked = false;
  if (!local.deviceRequests.length)
    $("local-request").append(text("option", "No simulated requests"));
  $("local-request").disabled = !local.deviceRequests.length || local.locked;
  localButtons();
  $("local-requests").replaceChildren(
    table(
      local.deviceRequests.map((r) => ({
        capability: `${r.call.moduleId}.${r.call.capability}`,
        state: r.state,
        result: r.result ?? "",
        error: r.error ?? "",
        retryOf: r.retryOf ?? "",
      })),
      "Simulated device requests",
    ),
  );
}
function localButtons() {
  const local = state.local;
  if (!local) return;
  const current = local.deviceRequests.find(
    (r) => r.id === $("local-request").value,
  );
  for (const id of ["local-run", "local-interrupt"])
    $(id).disabled = local.locked || current?.state !== "pending";
  $("local-clear").disabled =
    local.locked || !current || current.state === "running";
  $("local-review").disabled = local.locked || current?.state !== "uncertain";
  $("local-retry").disabled =
    local.locked ||
    !current ||
    !["rejected", "uncertain"].includes(current.state) ||
    (current.state === "uncertain" && !$("local-review").checked);
}
$("local-request").onchange = () => {
  $("local-review").checked = false;
  localButtons();
};
$("local-review").onchange = localButtons;
$("local-lock").onclick = () =>
  request({ action: "localProfile", locked: !state.local.locked }).catch(
    (e) => {
      $("local-feedback").textContent = e.message;
    },
  );
for (const [id, task] of [
  ["local-run", "process"],
  ["local-interrupt", "interrupt"],
  ["local-clear", "clear"],
  ["local-retry", "retry"],
])
  $(id).onclick = async () => {
    try {
      const data = await request({
        action: "localDevice",
        id: $("local-request").value,
        task,
        confirmUncertain: $("local-review").checked,
      });
      if (task === "retry") {
        $("local-request").value = data.result;
        $("local-review").checked = false;
        localButtons();
      }
      $("local-feedback").textContent =
        task === "interrupt"
          ? "Interrupted before saving the outcome. Lock and unlock to recover it for review."
          : "Simulation updated. No device action was performed.";
    } catch (error) {
      $("local-feedback").textContent = error.message;
    }
  };
function localControls() {
  $("local-access").replaceChildren();
  if (!state.local) return;
  for (const module of [
    state.module,
    ...Object.values(state.providers).map((p) => p.module),
  ]) {
    for (const [name, declaration] of Object.entries(
      module.capabilities ?? {},
    )) {
      const label = text(
          "label",
          `Allow ${module.name}: ${name} (${declaration.kind})`,
        ),
        input = document.createElement("input");
      input.type = "checkbox";
      input.dataset.module = module.id;
      input.dataset.capability = name;
      input.onchange = async () => {
        const allowed = input.checked;
        input.disabled = true;
        try {
          await request({
            action: "localAccess",
            moduleId: module.id,
            capability: name,
            allowed,
          });
        } catch (error) {
          $("local-feedback").textContent = error.message;
        } finally {
          renderLocal();
        }
      };
      label.prepend(input);
      $("local-access").append(label);
    }
  }
}
function serviceControls() {
  $("service-controls").hidden =
    !Object.keys(state.providers).length &&
    !Object.keys(state.module.services ?? {}).length;
  const modules = [
    { module: state.module, permissions: state.permissions },
    ...Object.values(state.providers),
  ];
  const selected = (kind = "service") =>
    [...$("grants").querySelectorAll(`input[data-kind="${kind}"]:checked`)].map(
      (input) => JSON.parse(input.value),
    );
  for (const { module } of modules)
    for (const [alias, reference] of Object.entries(module.services ?? {})) {
      const grant = {
        consumerId: module.id,
        providerId: reference.moduleId,
        operation: reference.operation,
      };
      const label = text(
        "label",
        `${module.id}: ${alias} (${reference.moduleId}.${reference.operation})`,
      );
      const box = document.createElement("input");
      box.type = "checkbox";
      box.value = JSON.stringify(grant);
      box.dataset.kind = "service";
      box.checked = state.grants.some((current) =>
        Object.keys(grant).every((key) => current[key] === grant[key]),
      );
      box.disabled = !modules.some(
        (provider) => provider.module.id === reference.moduleId,
      );
      box.onchange = () =>
        request({ action: "grants", grants: selected() }).catch((error) => {
          box.checked = !box.checked;
          feedback(error.message);
        });
      label.prepend(box);
      $("grants").append(label);
    }
  for (const { module } of modules) {
    const providers = new Set(
      Object.values(module.resources)
        .flatMap((resource) => referenceFields(resource.schema))
        .filter(
          (field) =>
            field.target.kind === "resource" &&
            field.target.moduleId !== module.id,
        )
        .map((field) => field.target.moduleId),
    );
    for (const providerId of providers) {
      const grant = { consumerId: module.id, providerId };
      const label = text(
        "label",
        `${module.id}: read references from ${providerId}`,
      );
      const box = document.createElement("input");
      box.type = "checkbox";
      box.dataset.kind = "read";
      box.value = JSON.stringify(grant);
      box.checked = state.readGrants.some(
        (current) =>
          current.consumerId === module.id && current.providerId === providerId,
      );
      box.disabled =
        !Object.hasOwn(module.dependencies, providerId) ||
        !modules.some((provider) => provider.module.id === providerId);
      box.onchange = () =>
        request({ action: "readGrants", grants: selected("read") }).catch(
          (error) => {
            box.checked = !box.checked;
            feedback(error.message);
          },
        );
      label.prepend(box);
      $("grants").append(label);
    }
  }
  for (const provider of Object.values(state.providers)) {
    const fieldset = document.createElement("fieldset");
    fieldset.append(text("legend", `${provider.module.name} permissions`));
    for (const permission of provider.module.permissions) {
      const label = text("label", permission),
        box = document.createElement("input");
      box.type = "checkbox";
      box.value = permission;
      box.checked = provider.permissions.includes(permission);
      box.onchange = () =>
        request({
          action: "permissions",
          moduleId: provider.module.id,
          permissions: [...fieldset.querySelectorAll("input:checked")].map(
            (input) => input.value,
          ),
        }).catch((error) => {
          box.checked = !box.checked;
          feedback(error.message);
        });
      label.prepend(box);
      fieldset.append(label);
    }
    $("provider-permissions").append(fieldset);
  }
}
function contract() {
  const [kind, name] = $("contract").value.split(":");
  return {
    kind,
    name,
    definition:
      kind === "resource"
        ? state.module.resources[name]
        : state.module.operations[name],
  };
}
function fields() {
  const { kind, definition } = contract();
  $("policy").textContent =
    `Execution policy: ${definition.policy}. ${kind === "resource" ? "Creates a record." : "Runs the staged operation."}`;
  $("fields").replaceChildren();
  const schema = kind === "resource" ? definition.schema : definition.input;
  if (schema.type !== "object") {
    const label = text("label", "Input JSON"),
      input = document.createElement("textarea");
    input.name = "__json";
    input.value = "{}";
    label.append(input);
    $("fields").append(label);
    return;
  }
  for (const [name, field] of Object.entries(schema.properties ?? {})) {
    const label = text("label", field.title ?? name);
    let input;
    if (field.anyOf?.every((s) => s.const !== undefined)) {
      input = document.createElement("select");
      if (!schema.required?.includes(name)) {
        const empty = text("option", "Choose a value");
        empty.value = "";
        input.append(empty);
      }
      field.anyOf.forEach((s) => {
        const option = text("option", s.const);
        option.value = s.const;
        input.append(option);
      });
    } else if (field.type === "object" || field.type === "array") {
      input = document.createElement("textarea");
      input.dataset.json = "true";
      input.value = field.type === "array" ? "[]" : "{}";
    } else {
      input = document.createElement("input");
      input.type =
        field.type === "boolean"
          ? "checkbox"
          : ["number", "integer"].includes(field.type)
            ? "number"
            : "text";
      if (field.type === "integer") input.step = "1";
      else if (field.type === "number") input.step = "any";
      if (field.minimum !== undefined) input.min = field.minimum;
      if (field.maximum !== undefined) input.max = field.maximum;
      if (field.maxLength) input.maxLength = field.maxLength;
    }
    input.name = name;
    input.setAttribute("aria-label", field.title ?? name);
    input.required =
      schema.required?.includes(name) && input.type !== "checkbox";
    label.append(input);
    $("fields").append(label);
  }
}
$("contract").onchange = fields;
$("online").onchange = () =>
  request({ action: "network", online: $("online").checked }).catch((e) =>
    feedback(e.message),
  );
$("sync").onclick = () =>
  request({ action: "sync" })
    .then(() =>
      feedback("Synchronization finished. Review each journal result."),
    )
    .catch((e) => feedback(e.message));
$("form").onsubmit = async (event) => {
  event.preventDefault();
  try {
    const { kind, name } = contract();
    let input = {};
    for (const field of $("fields").querySelectorAll("input,select,textarea")) {
      if (field.name === "__json") {
        input = JSON.parse(field.value);
        break;
      }
      if (field.value === "" && !field.required && field.type !== "checkbox")
        continue;
      input[field.name] = field.dataset.json
        ? JSON.parse(field.value)
        : field.type === "checkbox"
          ? field.checked
          : field.type === "number"
            ? Number(field.value)
            : field.value;
    }
    const data = await request({
      action: "submit",
      call: {
        moduleId: state.module.id,
        action: kind === "resource" ? "create" : "operation",
        ...(kind === "resource" ? { resource: name } : { operation: name }),
        input: kind === "resource" ? { data: input } : input,
        key: crypto.randomUUID(),
      },
    });
    feedback(
      data.result.state === "pending"
        ? "Pending server acceptance. Reconnect and synchronize to validate."
        : state.local
          ? "Saved in the standalone simulation. Device requests are simulated separately."
          : "Accepted by the simulated server.",
    );
  } catch (error) {
    feedback(error.message);
  }
};
async function load() {
  const response = await fetch("/state");
  state = await response.json();
  revision = state.revision;
  $("workspace").dataset.revision = revision;
  buildStatus = state.status;
  $("workspace").hidden = state.status !== "ready";
  $("build-status").textContent =
    state.status === "building"
      ? "Building module and checking types…"
      : state.status === "error"
        ? "Build failed. Fix the source to rebuild automatically."
        : "Ready. Each source or fixture change starts a fresh simulation.";
  $("build-error").hidden = !state.error;
  $("build-error").textContent = state.error ?? "";
  if (state.status !== "ready") {
    hidePreview();
    return;
  }
  $("title").textContent = `${state.module.name} ${state.module.version}`;
  if (state.local)
    $("host-description").textContent =
      "Host results are simulated. This preview does not download files, show system notifications or contact LAN peers. Standalone requests use explicit simulated consent and work without a server.";
  const hostModules = [
    state.module,
    ...(state.local ? Object.values(state.providers).map((p) => p.module) : []),
  ];
  $("host-controls").hidden = !hostModules.some(
    (module) => Object.keys(module.capabilities ?? {}).length,
  );
  for (const module of hostModules)
    for (const [name, declaration] of Object.entries(
      module.capabilities ?? {},
    )) {
      const option = text("option", `${name} (${declaration.kind})`);
      option.value =
        module.id === state.module.id ? name : `${module.id}/${name}`;
      if (module.id !== state.module.id)
        option.textContent = `${module.name}: ${option.textContent}`;
      $("host-capability").append(option);
    }
  if (!$("host-controls").hidden) hostResult();
  serviceControls();
  localControls();
  for (const [kind, definitions] of [
    ["resource", state.module.resources],
    ["operation", state.module.operations],
  ])
    for (const [name, definition] of Object.entries(definitions)) {
      const option = text("option", `${definition.title} (${kind})`);
      option.value = `${kind}:${name}`;
      $("contract").append(option);
    }
  for (const permission of state.module.permissions) {
    const label = text("label", permission),
      box = document.createElement("input");
    box.type = "checkbox";
    box.checked = state.permissions.includes(permission);
    box.value = permission;
    box.onchange = () =>
      request({
        action: "permissions",
        permissions: [
          ...$("permissions").querySelectorAll("input:checked"),
        ].map((e) => e.value),
      }).catch((e) => feedback(e.message));
    label.prepend(box);
    $("permissions").append(label);
  }
  renderState();
  if ($("contract").value) fields();
  else {
    $("form").hidden = true;
    $("contract").hidden = true;
    $("contract-label").hidden = true;
    $("policy").textContent = "No resource or operation contracts declared.";
  }
}
await load();
setInterval(async () => {
  try {
    const response = await fetch("/state");
    const next = await response.json();
    if (next.revision !== revision || next.status !== buildStatus)
      location.reload();
  } catch {}
}, 1500);
