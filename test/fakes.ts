import type {SocketLike, Timers} from '../src/haClient.ts';
import type {Storage} from '../src/config.ts';

export class FakeSocket implements SocketLike {
  onopen: SocketLike['onopen'] = null;
  onmessage: SocketLike['onmessage'] = null;
  onerror: SocketLike['onerror'] = null;
  onclose: SocketLike['onclose'] = null;
  sent: any[] = [];
  closed = false;
  readonly url: string;

  constructor(url: string) {
    this.url = url;
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(): void {
    this.closed = true;
  }

  /** Delivers a message from "Home Assistant". */
  receive(msg: unknown): void {
    this.onmessage?.({data: JSON.stringify(msg)});
  }

  /** Simulates the server dropping the connection. */
  drop(): void {
    this.onclose?.({code: 1006});
  }

  last(): any {
    return this.sent[this.sent.length - 1];
  }
}

/** Timers that only run when the test says so. */
export class FakeTimers implements Timers {
  private nextHandle = 1;
  timeouts = new Map<number, {fn: () => void; ms: number}>();
  intervals = new Map<number, {fn: () => void; ms: number}>();

  setTimeout(fn: () => void, ms: number): unknown {
    const h = this.nextHandle++;
    this.timeouts.set(h, {fn, ms});
    return h;
  }
  clearTimeout(h: unknown): void {
    this.timeouts.delete(h as number);
  }
  setInterval(fn: () => void, ms: number): unknown {
    const h = this.nextHandle++;
    this.intervals.set(h, {fn, ms});
    return h;
  }
  clearInterval(h: unknown): void {
    this.intervals.delete(h as number);
  }
  /** Runs all pending timeouts; returns their delays. */
  flushTimeouts(): number[] {
    const pending = [...this.timeouts.values()];
    this.timeouts.clear();
    pending.forEach(t => t.fn());
    return pending.map(t => t.ms);
  }
  tickIntervals(): void {
    [...this.intervals.values()].forEach(t => t.fn());
  }
}

export class MemoryStorage implements Storage {
  data = new Map<string, string>();
  async getItem(key: string): Promise<string | null> {
    return this.data.get(key) ?? null;
  }
  async setItem(key: string, value: string): Promise<void> {
    this.data.set(key, value);
  }
}

export const tick = () => new Promise(resolve => setImmediate(resolve));
