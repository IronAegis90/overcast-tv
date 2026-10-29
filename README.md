# overcast-tv

Vega OS (Fire TV) app for **Overcast**, which shows Home Assistant notifications as system toasts over whatever is playing. It replaces the Android app behind Home Assistant's [Notifications for Fire TV](https://www.home-assistant.io/integrations/nfandroidtv/), which Vega OS can't run.

It works with the [ha-overcast](https://github.com/IronAegis90/ha-overcast) Home Assistant integration.

> **Status: early development.** The JS and Hermes bundles build and the logic is unit tested, but the app has not run on the Vega Virtual Device or a real TV yet. See [Still to verify on a device](#still-to-verify-on-a-device).

## How it works

- **Setup UI** (`src/App.tsx`, component `io.github.ironaegis90.overcast.main`): enter the Home Assistant URL, a long-lived access token and a name for the TV. It also shows the connection status, and has a button that posts a test toast.
- **Headless service** (`service.js` → `src/service/`, component `io.github.ironaegis90.overcast.service`):
  - holds an outbound WebSocket connection to Home Assistant;
  - registers the TV with the integration;
  - shows each notification it receives as a system toast and acks it.

  The TV never listens for inbound connections.
- Vega doesn't start services by itself, so the UI starts the service when it opens (`Linking.openURL('pkg://…service')`). The service keeps running after you leave the app.
- The UI and the service run in separate JS runtimes. They share settings and status through AsyncStorage: the service polls for new settings every 5 s.
- [PROTOCOL.md](PROTOCOL.md) documents the messages exchanged with Home Assistant.

### Toasts from a headless service

The documented toast API, `useToastKepler`, is a React hook, so it can't run in a service, which has no React tree. The service posts to the same `NotificationManager` TurboModule the hook wraps, with the content the hook builds (`src/toastContent.ts`):

- The channel name selects the template: `SimpleToastRenderTemplate`, or `MenuToastRenderTemplate` when there is an open-app action. Any other name posts and draws nothing.
- `duration` maps to `mTimeout`, in seconds. The hook only offers SHORT = 4 and LONG = 8; the module takes any value.
- Icon size maps to the `mSmallIconUri` / `mLargeIconUri` fields, as the hook does.
- Icons must be `https://`. The renderer is a separate process that fetches the icon itself, and leaves http, `data:` and package URIs blank.

The SDK's own toast modules can't be imported from a service: the npm package only ships their type definitions, and `build-vega` gives services no system bundle for them. So the app looks up the TurboModule with `TurboModuleRegistry.getEnforcing('NotificationManager')` and defines the two small content classes itself. This mapping draws on [vega-service-toast](https://github.com/aarav1656/vega-service-toast) (MIT) and on the SDK's type definitions.

## Setup on the TV

1. Install and set up the ha-overcast integration in Home Assistant.
2. In Home Assistant, create a long-lived access token. A dedicated non-admin user is safest: **Profile → Security → Long-lived access tokens**.
3. Open Overcast on the TV and enter:
   - the Home Assistant URL, e.g. `https://example.ui.nabu.casa`, or `http://192.168.1.10:8123` on the local network;
   - the token;
   - a name for the TV.
4. Choose **Save and connect**. The status line should change to **Connected**, and the TV appears in Home Assistant.
5. **After every TV reboot, open Overcast once** so its service starts again.

Typing a ~180-character token with the remote is tedious. A pairing flow, where the TV shows a code you confirm in Home Assistant, is planned.

## Building

You need the [Vega SDK](https://developer.amazon.com/docs/vega/0.24/install-vega-sdk.html) (the `vega` CLI) and Node 22.18+.

```bash
npm install
npm run typecheck
npm test
npm run build        # react-native build-vega: JS/Hermes bundles, then the .vpkg via the Vega CLI
vega exec vpt validate manifest.toml
```

The project files were written by hand against the published SDK packages (RN for Vega 0.83, `@amazon-devices/react-native-kepler` 4.x), not generated with `vega project generate`. Two steps help if the toolchain complains:

- Run `vega project install --fix` to pin `@amazon-devices/*` versions.
- Compare against a fresh `vega project generate --template helloWorld`.

Install on the Vega Virtual Device or a TV as described in [Run your app](https://developer.amazon.com/docs/vega/0.24/run-apps.html).

## What can't match Notifications for Fire TV

Vega toasts are drawn by the system, so these nfandroidtv options have no equivalent:

- **Position:** the system places toasts.
- **Colors, transparency, font size:** the system styles toasts.
- **Large image below the text:** only the toast icon can show an image. Camera snapshots are shown as the icon.
- **Interrupt / take focus:** toasts never take focus. A notification can instead carry an action that opens an app.
- **Start on boot:** Vega has no documented way to start a service at boot, so the app has to be opened once after each reboot.

Supported: title, message, image as icon (https only), icon size, duration in seconds, and an "open app" action.

## Still to verify on a device

The Vega docs and the SDK leave these open. Check them on the Vega Virtual Device first, then on hardware:

1. `WebSocket` is available in the headless runtime. The docs' headless allow-list names `fetch` but not `WebSocket`. If it's missing, the plan is an HTTP long-poll fallback using `fetch`, with the same message schema.
2. Starting the service with `Linking.openURL('pkg://…service')` works, and the service keeps running while another app plays.
3. The toast privilege works when declared under `[[needs.privilege]]`, as the toast docs say. vega-service-toast declares it under `[[wants.privilege]]`.
4. The service's `runtime-module`. The headless docs and the RN 0.83 migration guide disagree; see the comment in `manifest.toml`.
5. AsyncStorage writes from the UI are visible to the service, which runs in another process group.
6. The `NotificationManager` TurboModule is reachable from the service, and `mTimeout` honours durations other than 4 and 8.
7. How long a start handler may run before the system ends it (reportedly ~8 s; the service returns immediately anyway).

## Project layout

```
manifest.toml           Vega manifest: UI + service components, privileges
index.js / src/App.tsx  setup UI
service.js              registers the headless entry points
src/service/            service entry points and the runner (config watch, status)
src/haClient.ts         Home Assistant WebSocket client (auth, register, ping, backoff)
src/toastContent.ts     notification → NotificationContent mapping
src/toast.ts            posts to the NotificationManager TurboModule
src/config.ts           settings/status shared through AsyncStorage
src/protocol.ts         message types (PROTOCOL.md)
test/                   node --test unit tests
```

## License

Apache-2.0
