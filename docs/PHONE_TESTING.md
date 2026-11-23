# Testing on a phone

Browsers only expose `navigator.geolocation` on secure (HTTPS) origins. A phone on the same Wi-Fi
hitting `http://<your-mac-ip>:5173` will **not** get location. The fix is a Cloudflare quick tunnel,
which gives the local dev server a public `https://….trycloudflare.com` URL — no account needed.

Only the Vite dev server (port 5173) is tunneled; it proxies `/api` to Express on port 3000, so one URL serves everything.

## One-time setup (macOS)

```bash
brew install cloudflared
```

## Every time

```bash
# Terminal 1
npm run dev:server

# Terminal 2
npm run dev:client

# Terminal 3
cloudflared tunnel --url http://localhost:5173
```

`cloudflared` prints a line like `https://random-words.trycloudflare.com`. Open that URL on the phone.
The URL changes every time you restart the tunnel. Vite is already configured to accept
`*.trycloudflare.com` hosts (`client/vite.config.ts → server.allowedHosts`).

Tip: to get the URL onto the phone quickly, paste it into any QR generator on the Mac, or AirDrop it.

## Enable precise location on the phone

**iPhone (iOS Safari / Chrome):**
1. Settings → Privacy & Security → Location Services → **On**.
2. Settings → Privacy & Security → Location Services → **Safari Websites** (or **Chrome**) →
   "While Using the App" **and Precise Location: On**.
3. When the page asks for location, tap **Allow**. If you previously denied it:
   Safari → `aA` in the address bar → Website Settings → Location → Allow.

**Android (Chrome):**
1. Settings → Location → **On**, and *Location services → Google Location Accuracy* → **On**.
2. Settings → Apps → Chrome → Permissions → Location → "Allow only while using the app",
   **Use precise location: On**.
3. If previously blocked: Chrome → ⋮ → Settings → Site settings → Location → remove the block for the tunnel URL.

## Location accuracy test (`/debug/location`)

Open `https://<tunnel>/debug/location` on the phone. The page shows:

- latest latitude, longitude, accuracy (±m), timestamp, and number of readings
- best (lowest) accuracy seen so far
- **Set as reference point** — stores the best reading; the page then shows live distance from it

Accuracy color: green ≤ 30 m (precise enough to start a session), amber ≤ 100 m, red > 100 m (would be rejected).

Suggested classroom test:
1. Stand at the lecturer's desk, wait ~10–20 s for accuracy to settle, tap **Set as reference point**.
2. Walk to the back row, the corners, the doorway and the hallway outside; note the distance and accuracy at each spot.
3. Repeat with an iPhone and an Android phone, and with Wi-Fi on vs. off (Wi-Fi usually improves indoor accuracy).

These numbers will guide the default radius (currently planned as 20 m) and the 30 m activation threshold.

## Testing phone-only screens on a laptop

Attendance screens show a QR code on laptops. To use them on the laptop anyway:

1. Add `?forceMobile=1` to the URL (remembered for the tab; `?forceMobile=0` turns it off).
2. Fake the location: Chrome DevTools → ⋮ → More tools → **Sensors** → Location → *Other…* and enter
   latitude / longitude. Accuracy is reported as ~150 m by default in some Chrome versions; if the start
   button stays disabled, use a real phone instead.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Red "not loaded over HTTPS" banner | You opened the `http://` LAN address; use the tunnel URL. |
| "Access to location was blocked" | Re-enable location for the browser/site (see above). |
| Accuracy stuck at hundreds of meters | Precise Location is off, or you're deep indoors — turn on Wi-Fi and wait. |
| `Blocked request. This host is not allowed` | Host isn't `*.trycloudflare.com`; add it to `allowedHosts` in `client/vite.config.ts`. |
| Tunnel page loads but data calls fail | `npm run dev:server` isn't running. |
| QR code on the laptop opens nothing on the phone | The laptop is on `localhost`; open the tunnel URL on the laptop first, then scan. |
