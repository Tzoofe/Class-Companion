const FORCE_KEY = 'cc_force_mobile';

/** `?forceMobile=1` (remembered for this tab) lets you test phone-only screens on a laptop. */
function forcedMobile(): boolean {
  try {
    const param = new URLSearchParams(window.location.search).get('forceMobile');
    if (param === '1') sessionStorage.setItem(FORCE_KEY, '1');
    if (param === '0') sessionStorage.removeItem(FORCE_KEY);
    return sessionStorage.getItem(FORCE_KEY) === '1';
  } catch {
    return new URLSearchParams(window.location.search).get('forceMobile') === '1';
  }
}

export function isMobileDevice(): boolean {
  const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  return forcedMobile() || window.matchMedia('(pointer: coarse)').matches || uaData?.mobile === true;
}
