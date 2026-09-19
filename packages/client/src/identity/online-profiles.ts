import { Type, assertSchema, type Static } from "@suite/module-sdk";
const Id = Type.String({
  pattern:
    "^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$",
});
export const OnlineProfileSchema = Type.Object(
  {
    id: Id,
    name: Type.String({ maxLength: 200 }),
    email: Type.String({ maxLength: 254 }),
    lastUsedAt: Type.Number(),
  },
  { additionalProperties: false },
);
export type OnlineProfile = Static<typeof OnlineProfileSchema>;
const DirectorySchema = Type.Array(
  Type.Union([
    OnlineProfileSchema,
    Type.Object(
      { id: Id, removed: Type.Literal(true) },
      { additionalProperties: false },
    ),
  ]),
);
type Entries = Static<typeof DirectorySchema>;
/** Saved sign-in metadata never grants account access or stores credentials. */
export class OnlineProfileDirectory {
  constructor(
    private store: {
      read(): Promise<unknown>;
      write(value: Entries): Promise<void>;
      exclusive<T>(run: () => Promise<T>): Promise<T>;
    },
  ) {}
  private async read() {
    const value = (await this.store.read()) ?? [];
    assertSchema(DirectorySchema, value);
    return value;
  }
  async list(): Promise<OnlineProfile[]> {
    return this.store.exclusive(async () =>
      (await this.read())
        .filter((p): p is OnlineProfile => !("removed" in p))
        .sort((a, b) => b.lastUsedAt - a.lastUsedAt),
    );
  }
  async remember(
    user: Pick<OnlineProfile, "id" | "name" | "email">,
    explicit: boolean,
    current: () => boolean = () => true,
  ) {
    const profile = {
      id: user.id,
      name: user.name,
      email: user.email,
      lastUsedAt: Date.now(),
    };
    assertSchema(OnlineProfileSchema, profile);
    await this.store.exclusive(async () => {
      const entries = await this.read();
      if (!current())
        throw Error("The active profile changed before it could be saved.");
      const previous = entries.find((p) => p.id === profile.id);
      // A background identity reply cannot resurrect a forgotten sign-in.
      if (previous && "removed" in previous && !explicit) return;
      await this.store.write([
        ...entries.filter((p) => p.id !== profile.id),
        profile,
      ]);
    });
  }
  async forget(id: string) {
    assertSchema(Id, id);
    await this.store.exclusive(async () => {
      const entries = await this.read();
      await this.store.write([
        ...entries.filter((p) => p.id !== id),
        { id, removed: true },
      ]);
    });
  }
}
