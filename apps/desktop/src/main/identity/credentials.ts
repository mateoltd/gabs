/** Main-process credentials. Refreshes and writes belong to one authentication generation. */
export interface CredentialTokens {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}
export class NativeCredentials {
  private access: string | undefined;
  private refresh: string | undefined;
  private expiresAt = 0;
  private writes: Promise<void> = Promise.resolve();
  private refreshing: { epoch: number; promise: Promise<void> } | undefined;
  constructor(
    private host: {
      epoch(): number;
      load(): Promise<{ refreshToken?: string } | undefined>;
      save(value: { refreshToken?: string }): Promise<void>;
      remove(): Promise<void>;
      renew(token: string): Promise<CredentialTokens>;
      now?(): number;
    },
  ) {}
  get accessToken() {
    return this.access;
  }
  get refreshToken() {
    return this.refresh;
  }
  private check(epoch: number, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (epoch !== this.host.epoch())
      throw Error("The authentication session changed.");
  }
  private exclusive(run: () => Promise<void>) {
    const next = this.writes.catch(() => {}).then(run);
    this.writes = next;
    return next;
  }
  async restore() {
    const epoch = this.host.epoch();
    const saved = await this.host.load();
    this.check(epoch);
    this.refresh = saved?.refreshToken;
  }
  async commit(
    tokens: CredentialTokens,
    epoch: number,
    source: "login" | "refresh",
    signal?: AbortSignal,
  ) {
    await this.exclusive(async () => {
      this.check(epoch, signal);
      // A new account must never inherit the previous account's refresh credential.
      const refreshToken =
        source === "refresh"
          ? (tokens.refresh_token ?? this.refresh)
          : tokens.refresh_token;
      await this.host.save({ refreshToken });
      this.check(epoch, signal);
      this.access = tokens.access_token;
      this.refresh = refreshToken;
      this.expiresAt =
        (this.host.now?.() ?? Date.now()) + (tokens.expires_in ?? 300) * 1000;
    });
    this.check(epoch, signal);
  }
  clear() {
    this.access = this.refresh = undefined;
    this.expiresAt = 0;
    this.refreshing = undefined;
    return this.exclusive(() => this.host.remove());
  }
  async ensure() {
    const epoch = this.host.epoch();
    if (
      this.access &&
      this.expiresAt > (this.host.now?.() ?? Date.now()) + 30000
    )
      return;
    if (!this.refresh) throw Error("Sign in to continue.");
    let flight = this.refreshing;
    if (!flight || flight.epoch !== epoch) {
      const token = this.refresh;
      flight = {
        epoch,
        promise: this.host
          .renew(token)
          .then((tokens) => this.commit(tokens, epoch, "refresh")),
      };
      this.refreshing = flight;
    }
    try {
      await flight.promise;
      this.check(epoch);
    } finally {
      // An old completion must not clear a newer account's in-flight refresh.
      if (this.refreshing === flight) this.refreshing = undefined;
    }
  }
}
