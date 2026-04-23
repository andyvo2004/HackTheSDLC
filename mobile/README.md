# QPP Mobile Wrapper (React Native / Expo)

This is a lightweight mobile wrapper for the existing QPP web app using React Native + Expo + WebView.

## What it does

- Loads the existing QPP app URL inside a native mobile shell.
- Supports pull-to-refresh.
- Shows a loading indicator and a retry screen if the web app is unreachable.

## Quick start

```bash
cd mobile
npm install
cp .env.example .env
# Update EXPO_PUBLIC_WEB_URL for your environment.
# For a physical device on same Wi-Fi, use your laptop LAN IP, e.g.:
# EXPO_PUBLIC_WEB_URL=http://192.168.1.25:5173
npm run start
```

Then run on iOS/Android from the Expo UI or with:

```bash
npm run ios
npm run android
```

## Notes

- Keep backend and frontend servers running while testing mobile.
- If local web URLs do not load on device, verify same network and firewall permissions.
