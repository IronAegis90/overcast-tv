/**
 * Posts a system toast from the headless service, through the
 * NotificationManager TurboModule that the SDK's useToastKepler hook wraps.
 * The module name is not a documented API: check it when updating
 * @amazon-devices/react-native-kepler.
 */

import {getEnforcing} from '@amazon-devices/react-native-kepler/Libraries/TurboModule/TurboModuleRegistry';

import type {NotificationEvent} from './protocol.ts';
import {buildToastContent, type NotificationContent} from './toastContent.ts';

interface NotificationManager {
  post(content: NotificationContent): unknown;
}

let manager: NotificationManager | null = null;

export async function postNotification(event: NotificationEvent): Promise<void> {
  manager ??= getEnforcing('NotificationManager') as unknown as NotificationManager;
  // A resolved post means the system accepted the toast, not that it drew.
  await manager.post(buildToastContent(event));
}
