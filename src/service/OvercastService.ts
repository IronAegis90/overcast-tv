/**
 * Entry points of the headless service (registered in service.js).
 * Only modules Vega allows in headless JS may be imported from here: no UI.
 */

import AsyncStorage from '@amazon-devices/react-native-async-storage__async-storage';

import {postNotification} from '../toast.ts';
import {ServiceRunner} from './runner.ts';

let runner: ServiceRunner | null = null;

export async function onStartService(): Promise<void> {
  // The UI starts the service on every launch; a running service ignores it.
  if (runner) {
    return;
  }
  runner = new ServiceRunner({
    storage: AsyncStorage,
    post: postNotification,
    log: msg => console.log(msg),
  });
  // Connects in the background. Return now: a start that has not returned
  // within about 8 s is ended by the system.
  runner.start();
}

export async function onStopService(): Promise<void> {
  runner?.stop();
  runner = null;
}
