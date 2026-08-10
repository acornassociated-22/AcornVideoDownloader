/** Detect Android APK client (or forced mobile preview). */
export function isAndroidClient(): boolean {
  const forced = import.meta.env.VITE_FORCE_MOBILE;
  if (forced === "1" || forced === "true") return true;
  if (typeof navigator === "undefined") return false;
  return /Android/i.test(navigator.userAgent);
}

/** Apply the Android layout class on <html> before first paint when possible. */
export function applyAndroidLayoutClass(): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("layout-android", isAndroidClient());
}
