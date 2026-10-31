# Overcast protocol, version 1

How the Overcast TV app ([overcast-tv](https://github.com/IronAegis90/overcast-tv)) and the Home Assistant integration ([ha-overcast](https://github.com/IronAegis90/ha-overcast)) talk to each other. Both repositories carry the same copy of this file. Update both copies, and bump `protocol`, on any incompatible change.

## Transport

The TV opens an outbound connection to Home Assistant's [WebSocket API](https://developers.home-assistant.io/docs/api/websocket) (`ws[s]://<home assistant>/api/websocket`) and authenticates with a long-lived access token. Nothing connects to the TV. The same URL works on the local network and through Home Assistant Cloud (Nabu Casa).

The integration adds two WebSocket commands. Neither needs an admin user, so the token can belong to a dedicated non-admin "Overcast" user.

## Connection

```
TV                                        Home Assistant
 |  ---- connect /api/websocket ---------->  |
 |  <--- {"type": "auth_required"} --------  |
 |  ---- {"type": "auth", "access_token"} ->  |
 |  <--- {"type": "auth_ok"} --------------  |
 |  ---- overcast/register (id 1) -------->  |   creates/updates the device
 |  <--- result (id 1) --------------------  |
 |  <--- event (id 1): notification -------  |   any number, any time
 |  ---- overcast/ack (id n) ------------->  |
 |  <--- result (id n) --------------------  |
 |  ---- ping (id n) / <--- pong ----------  |   every 30 s
```

### `overcast/register` (TV → HA)

```json
{
  "id": 1,
  "type": "overcast/register",
  "protocol": 1,
  "device_id": "6f1c2c7e-5a4b-4c3d-9e8f-0a1b2c3d4e5f",
  "name": "Living Room TV",
  "app_version": "0.1.0",
  "model": "Fire TV Stick 4K Select",
  "capabilities": {"launch": true, "icon_size": true}
}
```

| Field | Required | Meaning |
|---|---|---|
| `protocol` | yes | Protocol version the TV speaks. |
| `device_id` | yes | Stable id the TV generates on first run (UUID v4, at most 64 characters). It identifies the TV across reconnects and renames. |
| `name` | yes | Name the user gave the TV; becomes the device and notify entity name. |
| `app_version`, `model` | no | Shown on the device page. |
| `capabilities` | no | What the TV can render; informational in v1. |

The result is `{"protocol": 1}` on success, and the subscription stays open: notifications arrive as `event` messages with the register command's `id`. If the TV registers again with the same `device_id`, the new connection replaces the old one.

A `device_id` is bound to the Home Assistant user whose token first registered it. Device ids are visible to any signed-in user, so without this binding any user could take over a TV's notifications. Registering the same `device_id` with another user's token fails with `unauthorized` until the TV's device is deleted in Home Assistant.

Errors (`"success": false`):

| `error.code` | Meaning | TV should |
|---|---|---|
| `unsupported_protocol` | HA speaks another protocol version | stop and tell the user to update |
| `unknown_command` | the integration is not installed | stop and tell the user |
| `not_loaded` | the integration is installed but not set up | retry with backoff |
| `unauthorized` | the `device_id` is registered to another Home Assistant user | stop and tell the user to delete the TV's device in Home Assistant, or use that user's token |

### Notification event (HA → TV)

```json
{
  "id": 1,
  "type": "event",
  "event": {
    "kind": "notification",
    "nid": "01JBDF4Y8K7ZQ2V3W4X5Y6Z7A8",
    "expires_at": "2026-10-29T20:31:00+00:00",
    "title": "Front door",
    "message": "Motion detected",
    "duration": 8,
    "icon": {"url": "https://example.ui.nabu.casa/api/camera_proxy/camera.front_door?authSig=…", "size": "normal"},
    "launch": {"uri": "pkg://com.example.app.main", "title": "Open"}
  }
}
```

| Field | Required | Meaning |
|---|---|---|
| `nid` | yes | Unique id (ULID), echoed in the ack. |
| `expires_at` | yes | ISO 8601. If the TV receives the event after this time, it acks it as `expired` and doesn't show it. Live sends carry at least 30 s. |
| `title`, `message` | yes | Toast title and description. The integration defaults the title to "Home Assistant". |
| `duration` | yes | Seconds on screen (1–300). |
| `icon` | no | `url` is always `https://` and must be fetchable without credentials: the Vega toast renderer is a separate process that fetches it itself and draws nothing for http, `data:` or package URIs. `size` is `small`, `normal` or `large`. Without `icon`, the TV uses a default icon. |
| `launch` | no | Adds an action to the toast that opens `uri`, labelled `title`. |

### Reconnect event (HA → TV)

```json
{"id": 1, "type": "event", "event": {"kind": "reconnect"}}
```

The integration is unloading or reloading. The TV closes the socket and reconnects with backoff.

TVs ignore event kinds they don't know, so new kinds can be added without a version bump.

### `overcast/ack` (TV → HA)

```json
{"id": 7, "type": "overcast/ack", "device_id": "6f1c…", "nid": "01JB…", "status": "posted"}
```

`status` is `posted` (the system accepted the toast; whether it drew can't be observed), `failed` (with an `error` string) or `expired`. HA logs failures.

## Delivery

- Notifications for a TV that is not connected are queued: up to 10 per TV, each kept for exactly its `ttl` (default 60 s, up to 3600 s), and delivered in order when the TV registers. With `ttl: 0` the action fails instead.
- The TV pings every 30 s. If a ping gets no pong by the next one, it drops the connection and reconnects.
- Reconnects back off 1 s, 2 s, 4 s … up to 60 s, resetting after a successful registration. The TV stops retrying on `auth_invalid` until the user changes its settings.
