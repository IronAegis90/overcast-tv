/**
 * Maps an Overcast notification to the NotificationContent the Vega
 * NotificationManager TurboModule takes. This mirrors what the SDK's
 * useToastKepler hook builds, which can't be used here because a headless
 * service has no React tree.
 *
 * No Vega imports, so this runs under Node too.
 */

import type {NotificationEvent} from './protocol.ts';

/** Only these channel names draw; any other name posts and shows nothing. */
export const SIMPLE_TOAST = 'SimpleToastRenderTemplate';
export const MENU_TOAST = 'MenuToastRenderTemplate';

/**
 * Shown when a notification has no icon. It must be https: the renderer is a
 * separate process that fetches it and leaves http, data: and package URIs blank.
 */
export const DEFAULT_ICON_URL = 'https://brands.home-assistant.io/homeassistant/icon.png';

/**
 * Same shape as the SDK's AppLaunchTarget (ToastKepler/NotificationManagerUtils).
 * The SDK classes can't be imported from a service: the npm package only
 * ships their type definitions, and services get no system bundle for them.
 */
export class AppLaunchTarget {
  appUri: string;
  title: string;
  iconUri: string;

  constructor(appUri: string, title: string, iconUri: string) {
    this.appUri = appUri;
    this.title = title;
    this.iconUri = iconUri;
  }

  visit(visitor: {visitApp(target: AppLaunchTarget): unknown}): unknown {
    return visitor.visitApp(this);
  }
}

/** Same shape as the SDK's ToastKind. */
export class ToastKind {
  kindDescriptor = 5 as const;

  visit(visitor: {visitToast(kind: ToastKind): unknown}): void {
    visitor.visitToast(this);
  }
}

export interface NotificationContent {
  mTitle: string;
  mDescription: string;
  mIconUri: string;
  mSmallIconUri?: string;
  mLargeIconUri?: string;
  /** Seconds on screen. */
  mTimeout: number;
  mLaunchTargets: AppLaunchTarget[];
  mChannel: {importance: {importance: 'NORMAL'}; kind: ToastKind; name: string};
}

export function buildToastContent(event: NotificationEvent): NotificationContent {
  const iconUri = event.icon?.url ?? DEFAULT_ICON_URL;
  const size = event.icon?.size ?? 'normal';
  const launchTargets = event.launch
    ? [new AppLaunchTarget(event.launch.uri, event.launch.title, 'not_used')]
    : [];
  return {
    mTitle: event.title,
    mDescription: event.message,
    mIconUri: iconUri,
    // The SDK hook expresses icon size by also setting the sized icon field.
    ...(size === 'small' ? {mSmallIconUri: iconUri} : {}),
    ...(size === 'large' ? {mLargeIconUri: iconUri} : {}),
    mTimeout: event.duration,
    mLaunchTargets: launchTargets,
    mChannel: {
      importance: {importance: 'NORMAL'},
      kind: new ToastKind(),
      name: event.launch ? MENU_TOAST : SIMPLE_TOAST,
    },
  };
}
