/**
 * Settings and status shared between the setup UI and the headless service.
 * They run in separate JS runtimes, so they talk through AsyncStorage: the UI
 * writes the config, the service polls it and writes back its status.
 */

export interface Storage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface OvercastConfig {
  url: string;
  token: string;
  name: string;
  deviceId: string;
  /** Bumped on every save so the service notices changes. */
  revision: number;
}

export interface ServiceStatus {
  state: string;
  detail?: string;
  /** Epoch ms of the service's latest write (a heartbeat, not the state change). */
  at: number;
  lastNotification?: {title: string; at: number; status: string};
}

/**
 * The service rewrites its status at least every 5 s; the UI treats an older
 * status as "service not running".
 */
export const STATUS_STALE_MS = 15_000;

const CONFIG_KEY = 'overcast.config';
const STATUS_KEY = 'overcast.status';

async function readJson<T>(storage: Storage, key: string): Promise<T | null> {
  const raw = await storage.getItem(key);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** RFC 4122 v4. Math.random is enough: the id only has to be unique per household. */
export function newDeviceId(random: () => number = Math.random): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.floor(random() * 16);
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function loadConfig(storage: Storage): Promise<OvercastConfig | null> {
  return readJson<OvercastConfig>(storage, CONFIG_KEY);
}

/** Saves the settings, keeping the device id and bumping the revision. */
export async function saveConfig(
  storage: Storage,
  settings: Pick<OvercastConfig, 'url' | 'token' | 'name'>,
): Promise<OvercastConfig> {
  const current = await loadConfig(storage);
  const config: OvercastConfig = {
    url: settings.url.trim(),
    token: settings.token.trim(),
    name: settings.name.trim(),
    deviceId: current?.deviceId ?? newDeviceId(),
    revision: (current?.revision ?? 0) + 1,
  };
  await storage.setItem(CONFIG_KEY, JSON.stringify(config));
  return config;
}

export function isComplete(config: OvercastConfig | null): config is OvercastConfig {
  return !!config && !!config.url && !!config.token && !!config.name;
}

export function loadStatus(storage: Storage): Promise<ServiceStatus | null> {
  return readJson<ServiceStatus>(storage, STATUS_KEY);
}

export async function saveStatus(storage: Storage, status: ServiceStatus): Promise<void> {
  await storage.setItem(STATUS_KEY, JSON.stringify(status));
}
