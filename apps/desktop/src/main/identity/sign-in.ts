/** Coalesce one sign-in; cancellation detaches it before a replacement can start. */
export class NativeSignIn {
  private current:
    { controller: AbortController; promise: Promise<void> } | undefined;
  run(start: (signal: AbortSignal) => Promise<void>): Promise<void> {
    if (this.current) return this.current.promise;
    const controller = new AbortController();
    const attempt = {
      controller,
      promise: Promise.resolve()
        .then(async () => {
          controller.signal.throwIfAborted();
          await start(controller.signal);
          controller.signal.throwIfAborted();
        })
        .catch((error) => {
          controller.abort(error);
          throw error;
        })
        .finally(() => {
          if (this.current === attempt) this.current = undefined;
        }),
    };
    this.current = attempt;
    return attempt.promise;
  }
  cancel(reason = "Sign-in cancelled by sign-out.") {
    this.current?.controller.abort(Error(reason));
    this.current = undefined;
  }
}
