# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately, not in a public issue:
**[Report a vulnerability](https://github.com/IronAegis90/overcast-tv/security/advisories/new)** (GitHub private vulnerability reporting).

Include what you found, how to reproduce it, the app version, and the device (or Vega Virtual Device and SDK version). You should get a reply within a week. Please give a fix time to ship before you disclose publicly.

## Scope

In scope: the Overcast Vega app in this repository. That covers how it stores the Home Assistant URL and token, its connection to Home Assistant, and how it turns notifications into toasts.

Out of scope: Vega OS, the Amazon Appstore and Home Assistant itself. Report those to Amazon or the Home Assistant project. Vulnerabilities in the Home Assistant integration go to [ha-overcast](https://github.com/IronAegis90/ha-overcast/security/advisories/new).

## Supported versions

Only the latest release gets security fixes.

## Keeping your setup safe

- Use an `https://` Home Assistant URL (for example Home Assistant Cloud) whenever the TV connects from outside your local network. With `http://`, the token is sent unencrypted.
- Use a token from a dedicated **non-admin** Home Assistant user, and delete it if the TV is lost or sold.
- Never paste a long-lived access token into an issue, log or screenshot.
