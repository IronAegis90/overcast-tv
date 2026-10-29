// Entry file of the headless service; react-native build-vega bundles it as
// service.hermes.bundle. index.js is the UI's entry.
import {HeadlessEntryPointRegistry} from '@amazon-devices/headless-task-manager';

import {SERVICE_ID} from './src/ids.ts';
import {onStartService, onStopService} from './src/service/OvercastService.ts';

HeadlessEntryPointRegistry.registerHeadlessEntryPoint(
  `${SERVICE_ID}::onStartService`,
  () => onStartService,
);
HeadlessEntryPointRegistry.registerHeadlessEntryPoint(
  `${SERVICE_ID}::onStopService`,
  () => onStopService,
);
