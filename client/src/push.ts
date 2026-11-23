import { api } from './api';

/**
 * needs-install: iPhone/iPad in Safari — push works only from the home-screen app.
 * unconfigured: the server has no VAPID keys.
 */
export type PushState = 'loading' | 'unsupported' | 'needs-install' | 'unconfigured' | 'denied' | 'off' | 'on';

export const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function keyToBytes(base64url: string) {
  const b64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

const saveOnServer = (sub: PushSubscription) => api('/push/subscribe', { method: 'POST', json: sub.toJSON() });

/** Current state for this device. Re-sends an existing subscription so it's linked to whoever is logged in now. */
export async function getPushState(): Promise<PushState> {
  if (!supported()) return isIOS() && !isStandalone() ? 'needs-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub || Notification.permission !== 'granted') return 'off';
  await saveOnServer(sub).catch(() => {});
  return 'on';
}

/** Must run from a tap (iOS only shows the permission prompt for a user gesture). */
export async function enablePush(): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission === 'denied') return 'denied';
  if (permission !== 'granted') return 'off';
  const { publicKey } = await api<{ publicKey: string | null }>('/push/public-key');
  if (!publicKey) return 'unconfigured';
  const reg = await navigator.serviceWorker.ready;
  // A subscription made with an older server key can't be reused.
  await (await reg.pushManager.getSubscription())?.unsubscribe();
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) });
  await saveOnServer(sub);
  return 'on';
}

export async function disablePush(): Promise<PushState> {
  if (!supported()) return 'unsupported';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await api('/push/unsubscribe', { method: 'POST', json: { endpoint: sub.endpoint } }).catch(() => {});
    await sub.unsubscribe();
  }
  return 'off';
}

export const sendTestPush = () => api<{ sent: number; removed: number }>('/push/test', { method: 'POST' });
