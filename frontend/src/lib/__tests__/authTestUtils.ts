/** In-memory BroadcastChannel: all instances of a name see each other's messages (not their own). */
export class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = [];
  private listeners = new Set<(e: MessageEvent) => void>();
  closed = false;
  constructor(readonly name: string) {
    FakeBroadcastChannel.instances.push(this);
  }
  static install() {
    FakeBroadcastChannel.instances = [];
    globalThis.BroadcastChannel = FakeBroadcastChannel as unknown as typeof BroadcastChannel;
  }
  /** A channel owned by "another tab". */
  static external(): FakeBroadcastChannel {
    return new FakeBroadcastChannel("cc-auth");
  }
  static sent: unknown[] = [];
  addEventListener(_type: string, l: (e: MessageEvent) => void) {
    this.listeners.add(l);
  }
  postMessage(data: unknown) {
    FakeBroadcastChannel.sent.push(data);
    for (const other of FakeBroadcastChannel.instances) {
      if (other === this || other.closed || other.name !== this.name) continue;
      void Promise.resolve().then(() =>
        other.listeners.forEach((l) => l({ data } as MessageEvent)),
      );
    }
  }
  close() {
    this.closed = true;
  }
}
