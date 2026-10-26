type Waiter = {
  resolve: (release: () => void) => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
  abort: () => void;
};
export class QueryGate {
  private active = 0;
  private waiting: Waiter[] = [];
  constructor(readonly limit: number) {}
  async run<T>(action: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    const release = await new Promise<() => void>((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        signal,
        abort: () => {
          const index = this.waiting.indexOf(waiter);
          if (index >= 0) this.waiting.splice(index, 1);
          reject(signal?.reason);
        },
      };
      signal?.addEventListener("abort", waiter.abort, { once: true });
      this.waiting.push(waiter);
      this.drain();
    });
    try {
      signal?.throwIfAborted();
      return await action();
    } finally {
      release();
    }
  }
  private drain() {
    while (this.active < this.limit && this.waiting.length) {
      const waiter = this.waiting.shift()!;
      waiter.signal?.removeEventListener("abort", waiter.abort);
      if (waiter.signal?.aborted) {
        waiter.reject(waiter.signal.reason);
        continue;
      }
      this.active++;
      let released = false;
      waiter.resolve(() => {
        if (released) return;
        released = true;
        this.active--;
        this.drain();
      });
    }
  }
}
// A single local server may run two investigations; they share the same SQL budget.
export const zetarisQueries = new QueryGate(2);
