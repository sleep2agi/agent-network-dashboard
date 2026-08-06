# Agent Network Mobile/Desktop App Shells

This repo ships three thin wrappers around the existing Dashboard web UI:

- PWA: installable from mobile Safari/Chrome when served over HTTPS.
- iOS/Android: Capacitor WebView shell pointed at a Dashboard URL.
- macOS/desktop: Electron shell pointed at the same Dashboard URL.

Desktop and Capacitor development default to `http://127.0.0.1:3000`. A physical mobile device cannot reach the host through its own loopback address, so set an explicit HTTPS URL that the device can reach:

```bash
export ANET_DASHBOARD_URL="https://your-dashboard.example.com"
```

## PWA

Build and run the normal Dashboard:

```bash
npm run build
anet hub dashboard --host 0.0.0.0 --port 3000
```

Open the HTTPS Dashboard from a phone and use "Add to Home Screen".

## iOS

```bash
npm install
ANET_DASHBOARD_URL=https://dashboard.example.com npm run app:ios:init
ANET_DASHBOARD_URL=https://dashboard.example.com npm run app:ios:sync
npm run app:ios:open
```

Requires Xcode on macOS.

## Android

```bash
npm install
ANET_DASHBOARD_URL=https://dashboard.example.com npm run app:android:init
ANET_DASHBOARD_URL=https://dashboard.example.com npm run app:android:sync
npm run app:android:open
```

Requires Android Studio.

## macOS/Desktop

```bash
npm install
ANET_DASHBOARD_URL=https://dashboard.example.com npm run app:desktop
npm run app:desktop:pack
```

The desktop shell is intentionally thin: authentication, data access, upload,
and realtime behavior remain in the Dashboard and CommHub services.
