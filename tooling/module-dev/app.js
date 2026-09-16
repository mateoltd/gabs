import { updatePreview, hidePreview } from "/preview.js";
const $ = (id) => document.getElementById(id);
let state, revision, buildStatus;
const text = (tag, value) => {
  const element = document.createElement(tag);
  element.textContent = value;
  return element;
};
async function request(body) {
  const response = await fetch("/action", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-module-dev-revision": revision,
    },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw Object.assign(Error(data.message), data);
  state = { ...state, ...data };
  renderState();
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
  $("records").replaceChildren(
    ...Object.entries(state.records).flatMap(([name, rows]) => [
      text("h3", name),
      table(
        rows.map((r) => ({ id: r.id, ...r.data, version: r.version })),
        `${name} records`,
      ),
    ]),
  );
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
  updatePreview(
    state,
    async (call) => (await request({ action: "execute", call })).result,
  );
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
  else $("form").hidden = true;
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
