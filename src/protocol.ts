/**
 * Overcast protocol v1: the messages exchanged with the ha-overcast integration
 * over Home Assistant's WebSocket API. Keep in sync with PROTOCOL.md.
 */

export const PROTOCOL_VERSION = 1;

export type IconSize = 'small' | 'normal' | 'large';

export interface NotificationEvent {
  kind: 'notification';
  /** Unique id, echoed back in the ack. */
  nid: string;
  /** ISO 8601. A notification received after this is acked as expired. */
  expires_at: string;
  title: string;
  message: string;
  /** Seconds on screen. */
  duration: number;
  /** An https URL the toast renderer can fetch without credentials. */
  icon?: {url: string; size: IconSize};
  /** Adds an action to the toast that opens an app. */
  launch?: {uri: string; title: string};
}

/** The integration is unloading: close the socket and connect again. */
export interface ReconnectEvent {
  kind: 'reconnect';
}

export type ServerEvent = NotificationEvent | ReconnectEvent;

export type AckStatus = 'posted' | 'failed' | 'expired';

export interface Registration {
  /** Generated on first run and kept for the life of the install. */
  device_id: string;
  name: string;
  app_version: string;
  model?: string;
  capabilities: {launch: boolean; icon_size: boolean};
}
