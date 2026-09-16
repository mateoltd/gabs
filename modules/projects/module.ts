import { defineModule, resource, field, Type } from "@suite/module-sdk";
export default defineModule({
  id: "projects",
  name: "Projects",
  version: "1.1.0",
  description: "Projects, tasks, comments and time capture.",
  host: "^1.0.0",
  backend: "^1.0.0",
  publisher: "suite",
  dependencies: { contacts: "^1.0.0" },
  permissions: [
    "projects.projects.read",
    "projects.projects.write",
    "projects.tasks.read",
    "projects.tasks.write",
    "projects.comments.read",
    "projects.comments.write",
    "projects.time.read",
    "projects.time.write",
  ],
  configuration: Type.Object({}, { additionalProperties: false }),
  operations: {},
  navigation: { path: "/projects", permission: "projects.projects.read" },
  resources: {
    projects: resource(
      {
        name: field.text({ minLength: 1, maxLength: 200 }),
        status: field.enum(["planned", "active", "completed", "cancelled"]),
        contactId: field.optional(field.reference("contacts", "contacts")),
        dueDate: field.optional(field.date()),
        description: field.optional(field.text({ maxLength: 5000 })),
      },
      {
        title: "Projects",
        columns: ["name", "status", "dueDate"],
        standalone: true,
      },
    ),
    tasks: resource(
      {
        projectId: field.reference("projects", "projects"),
        title: field.text({ minLength: 1 }),
        status: field.enum(["todo", "in-progress", "done"]),
        assignee: field.optional(
          field.text({ maxLength: 254, title: "Assignment note" }),
        ),
        assigneeId: field.optional(field.member({ title: "Assignee" })),
        dueDate: field.optional(field.date()),
        description: field.optional(field.text({ maxLength: 5000 })),
      },
      {
        title: "Tasks",
        columns: ["title", "status", "assigneeId", "dueDate"],
        standalone: true,
      },
    ),
    comments: resource(
      {
        taskId: field.reference("projects", "tasks"),
        text: field.text({ minLength: 1, maxLength: 10000 }),
      },
      { title: "Comments", standalone: true, appendOnly: true },
    ),
    time: resource(
      {
        taskId: field.reference("projects", "tasks"),
        date: field.date(),
        minutes: field.integer({ minimum: 1, maximum: 1440 }),
        note: field.optional(field.text()),
      },
      { title: "Time entries", standalone: true, appendOnly: true },
    ),
  },
});
