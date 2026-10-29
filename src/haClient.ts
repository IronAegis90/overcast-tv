/**
 * Holds the TV's connection to Home Assistant's WebSocket API: authenticates
 * with a long-lived access token, registers with the Overcast integration,
 * keeps the socket alive and reconnects with backoff.
 *
 * Has no Vega imports so it runs (and is tested) under Node too.
 */

import {
  PROTOCOL_VERSION,
  type AckStatus,
  type NotificationEvent,
  type Registration,
  type ServerEvent,
} from './protocol.ts';

export type ClientState =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'auth_failed'
  | 'unsupported'
  | 'stopped';

export interface ClientStatus {
  state: ClientState;
  detail?: string;
}

export interface DeliveryResult {
  status: AckStatus;
  error?: string;
}

/** The subset of the WebSocket API the client uses. */
export interface SocketLike {
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: {data: unknown}) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: {code?: number; reason?: string}) => void) | null;
  send(data: string): void;
  close(): void;
}

export type SocketFactory = (url: string) => SocketLike;

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface ClientOptions {
  /** Home Assistant base URL as the user typed it, e.g. https://x.ui.nabu.casa */
  url: string;
  token: string;
  registration: Registration;
  onNotification(event: NotificationEvent): Promise<DeliveryResult>;
  onStatus?(status: ClientStatus): void;
  socketFactory?: SocketFactory;
  timers?: Timers;
  now?: () => number;
}

export const PING_INTERVAL_MS = 30_000;
export const MAX_BACKOFF_MS = 60_000;

const REGISTER_ID = 1;

/** Turns the HA base URL the user entered into its WebSocket API endpoint. */
export function websocketUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  const match = /^(https?):\/\/(.+)$/i.exec(trimmed);
  if (!match) {
    throw new Error('The Home Assistant URL must start with http:// or https://');
  }
  const scheme = match[1].toLowerCase() === 'https' ? 'wss' : 'ws';
  return `${scheme}://${match[2]}/api/websocket`;
}

/** Delay before reconnect attempt `attempt` (0-based): 1 s, 2 s, 4 s ... 60 s. */
export function backoffMs(attempt: number): number {
  return Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt);
}

const defaultTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: handle => clearInterval(handle as ReturnType<typeof setInterval>),
};

export class OvercastClient {
  private readonly opts: ClientOptions;
  private readonly timers: Timers;
  private readonly now: () => number;
  private socket: SocketLike | null = null;
  private nextId = REGISTER_ID + 1;
  private attempt = 0;
  private reconnectTimer: unknown = null;
  private pingTimer: unknown = null;
  private awaitingPong = false;
  private stopped = true;
  status: ClientStatus = {state: 'stopped'};

  constructor(opts: ClientOptions) {
    this.opts = opts;
    this.timers = opts.timers ?? defaultTimers;
    this.now = opts.now ?? Date.now;
  }

  /** Connects in the background; returns immediately. */
  start(): void {
    if (!this.stopped) {
      return;
    }
    this.stopped = false;
    this.attempt = 0;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.closeSocket();
    this.setStatus({state: 'stopped'});
  }

  private connect(): void {
    this.reconnectTimer = null;
    let url: string;
    try {
      url = websocketUrl(this.opts.url);
    } catch (err) {
      this.stopped = true;
      this.setStatus({state: 'disconnected', detail: String((err as Error).message)});
      return;
    }
    this.setStatus({state: 'connecting'});
    const factory: SocketFactory =
      this.opts.socketFactory ??
      (u => new (globalThis as unknown as {WebSocket: new (u: string) => SocketLike}).WebSocket(u));
    let socket: SocketLike;
    try {
      socket = factory(url);
    } catch (err) {
      this.scheduleReconnect(String(err));
      return;
    }
    this.socket = socket;
    socket.onmessage = ev => {
      if (this.socket === socket) {
        this.handleMessage(ev.data);
      }
    };
    socket.onerror = () => {
      // onclose follows and handles the reconnect.
    };
    socket.onclose = ev => {
      if (this.socket !== socket) {
        return;
      }
      this.socket = null;
      this.clearPing();
      if (!this.stopped) {
        this.scheduleReconnect(ev.reason || `closed (${ev.code ?? 'no code'})`);
      }
    };
  }

  private handleMessage(data: unknown): void {
    let msg: any;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    switch (msg.type) {
      case 'auth_required':
        this.send({type: 'auth', access_token: this.opts.token});
        return;
      case 'auth_invalid':
        // Retrying with the same token cannot succeed; wait for new settings.
        this.stopped = true;
        this.closeSocket();
        this.setStatus({state: 'auth_failed', detail: msg.message});
        return;
      case 'auth_ok':
        this.send({
          id: REGISTER_ID,
          type: 'overcast/register',
          protocol: PROTOCOL_VERSION,
          ...this.opts.registration,
        });
        return;
      case 'result':
        if (msg.id === REGISTER_ID) {
          this.handleRegisterResult(msg);
        }
        return;
      case 'pong':
        this.awaitingPong = false;
        return;
      case 'event':
        if (msg.id === REGISTER_ID) {
          void this.handleEvent(msg.event as ServerEvent);
        }
        return;
    }
  }

  private handleRegisterResult(msg: any): void {
    if (msg.success) {
      this.attempt = 0;
      this.setStatus({state: 'connected'});
      this.startPing();
      return;
    }
    const code: string | undefined = msg.error?.code;
    if (code === 'unsupported_protocol' || code === 'unknown_command') {
      // HA without the integration answers unknown_command.
      this.stopped = true;
      this.closeSocket();
      this.setStatus({
        state: 'unsupported',
        detail:
          code === 'unknown_command'
            ? 'The Overcast integration is not installed in Home Assistant'
            : msg.error.message,
      });
      return;
    }
    // not_loaded (integration not set up yet) and the like: try again later.
    this.closeSocket();
    this.scheduleReconnect(msg.error?.message ?? 'registration failed');
  }

  private async handleEvent(event: ServerEvent): Promise<void> {
    if (event.kind === 'reconnect') {
      this.closeSocket();
      this.scheduleReconnect('Home Assistant asked to reconnect');
      return;
    }
    if (event.kind !== 'notification') {
      return;
    }
    let result: DeliveryResult;
    if (Date.parse(event.expires_at) < this.now()) {
      result = {status: 'expired'};
    } else {
      try {
        result = await this.opts.onNotification(event);
      } catch (err) {
        result = {status: 'failed', error: String(err)};
      }
    }
    this.send({
      type: 'overcast/ack',
      device_id: this.opts.registration.device_id,
      nid: event.nid,
      status: result.status,
      ...(result.error ? {error: result.error} : {}),
    });
  }

  /** Sends a message, giving it an id when it is a command. */
  private send(msg: Record<string, unknown>): void {
    if (!this.socket) {
      return;
    }
    const isCommand = msg.type !== 'auth' && msg.id === undefined;
    const payload = isCommand ? {id: this.nextId++, ...msg} : msg;
    this.socket.send(JSON.stringify(payload));
  }

  private startPing(): void {
    this.clearPing();
    this.awaitingPong = false;
    this.pingTimer = this.timers.setInterval(() => {
      if (this.awaitingPong) {
        // No pong for a whole interval: the connection is dead.
        this.closeSocket();
        this.scheduleReconnect('no response to ping');
        return;
      }
      this.awaitingPong = true;
      this.send({type: 'ping'});
    }, PING_INTERVAL_MS);
  }

  private scheduleReconnect(detail: string): void {
    this.clearPing();
    if (this.stopped || this.reconnectTimer !== null) {
      return;
    }
    const delay = backoffMs(this.attempt++);
    this.setStatus({state: 'disconnected', detail});
    this.reconnectTimer = this.timers.setTimeout(() => this.connect(), delay);
  }

  private closeSocket(): void {
    const socket = this.socket;
    this.socket = null;
    this.clearPing();
    if (socket) {
      try {
        socket.close();
      } catch {
        // Already closed.
      }
    }
  }

  private clearPing(): void {
    if (this.pingTimer !== null) {
      this.timers.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearPing();
    if (this.reconnectTimer !== null) {
      this.timers.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setStatus(status: ClientStatus): void {
    this.status = status;
    this.opts.onStatus?.(status);
  }
}
