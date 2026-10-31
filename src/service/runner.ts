/**
 * The headless service's work: watch the saved config, keep one
 * OvercastClient connected for it, show incoming notifications as toasts and
 * report status back to the UI.
 */

import {
  isComplete,
  loadConfig,
  saveStatus,
  type OvercastConfig,
  type ServiceStatus,
  type Storage,
} from '../config.ts';
import {OvercastClient, type ClientOptions, type DeliveryResult} from '../haClient.ts';
import {APP_VERSION} from '../ids.ts';
import type {NotificationEvent} from '../protocol.ts';

/** Also the status heartbeat: keep it well under STATUS_STALE_MS. */
export const CONFIG_POLL_MS = 5_000;

export interface RunnerDeps {
  storage: Storage;
  post(event: NotificationEvent): Promise<void>;
  /** Overrides for tests. */
  clientOptions?: Partial<ClientOptions>;
  setInterval?(fn: () => void, ms: number): unknown;
  clearInterval?(handle: unknown): void;
  log?(msg: string): void;
}

export class ServiceRunner {
  private readonly deps: RunnerDeps;
  private client: OvercastClient | null = null;
  private revision = -1;
  private poller: unknown = null;
  private checking = false;
  private stopped = true;
  private status: ServiceStatus = {state: 'starting', at: Date.now()};

  constructor(deps: RunnerDeps) {
    this.deps = deps;
  }

  /** Returns at once; the system ends a service whose start does not return. */
  start(): void {
    if (this.poller !== null) {
      return;
    }
    this.stopped = false;
    const setInt = this.deps.setInterval ?? ((fn, ms) => setInterval(fn, ms));
    this.poller = setInt(() => void this.checkConfig(), CONFIG_POLL_MS);
    void this.checkConfig();
  }

  stop(): void {
    this.stopped = true;
    if (this.poller !== null) {
      (this.deps.clearInterval ?? (h => clearInterval(h as ReturnType<typeof setInterval>)))(
        this.poller,
      );
      this.poller = null;
    }
    this.client?.stop();
    this.client = null;
  }

  /**
   * Reconnects when the UI saved new settings, and refreshes the status
   * timestamp so the UI can tell the service is alive. Checks never overlap:
   * a slow read is not raced by the next poll.
   */
  async checkConfig(): Promise<void> {
    if (this.checking || this.stopped) {
      return;
    }
    this.checking = true;
    try {
      await this.applyConfig();
    } finally {
      this.checking = false;
    }
  }

  private async applyConfig(): Promise<void> {
    let config: OvercastConfig | null;
    try {
      config = await loadConfig(this.deps.storage);
    } catch (err) {
      this.deps.log?.(`overcast: reading config failed: ${String(err)}`);
      return;
    }
    if (this.stopped) {
      // stop() ran while the read was pending: start nothing.
      return;
    }
    const revision = config?.revision ?? 0;
    if (revision === this.revision) {
      await this.heartbeat();
      return;
    }
    this.revision = revision;
    this.client?.stop();
    this.client = null;
    if (!isComplete(config)) {
      await this.report({state: 'unconfigured', at: Date.now()});
      return;
    }
    this.client = new OvercastClient({
      url: config.url,
      token: config.token,
      registration: {
        device_id: config.deviceId,
        name: config.name,
        app_version: APP_VERSION,
        capabilities: {launch: true, icon_size: true},
      },
      onNotification: event => this.deliver(event),
      onStatus: s => void this.report({...this.status, state: s.state, detail: s.detail, at: Date.now()}),
      ...this.deps.clientOptions,
    });
    this.client.start();
  }

  private async deliver(event: NotificationEvent): Promise<DeliveryResult> {
    let result: DeliveryResult;
    try {
      await this.deps.post(event);
      result = {status: 'posted'};
    } catch (err) {
      result = {status: 'failed', error: String(err)};
    }
    await this.report({
      ...this.status,
      at: Date.now(),
      lastNotification: {title: event.title, at: Date.now(), status: result.status},
    });
    return result;
  }

  private async heartbeat(): Promise<void> {
    this.status = {...this.status, at: Date.now()};
    try {
      await saveStatus(this.deps.storage, this.status);
    } catch {
      // Logged by report() on the next state change.
    }
  }

  private async report(status: ServiceStatus): Promise<void> {
    this.status = status;
    this.deps.log?.(`overcast: ${status.state}${status.detail ? ` (${status.detail})` : ''}`);
    try {
      await saveStatus(this.deps.storage, status);
    } catch (err) {
      this.deps.log?.(`overcast: writing status failed: ${String(err)}`);
    }
  }
}
