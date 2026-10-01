/** Resolve backing pixels without confusing page DPR with visual pinch zoom. */
export function surfaceResolution({
  width,
  height,
  deviceDpr = 1,
  zoom = 1,
  displayScale = 1,
  maxDpr = 3,
  maxZoom = 3,
  maxPixels = 8388608,
  maxDimension = 8192,
  availableBytes = Infinity,
}) {
  width = Math.max(1, width);
  height = Math.max(1, height);
  const finite = (n, fallback) => (Number.isFinite(n) && n > 0 ? n : fallback);
  const requested =
    Math.min(finite(deviceDpr, 1), maxDpr) *
    Math.min(Math.max(1, finite(zoom, 1)), maxZoom) *
    finite(displayScale, 1);
  const pixelLimit = Math.min(maxPixels, Math.max(1, availableBytes / 4));
  const ratio = Math.min(
    requested,
    Math.sqrt(pixelLimit / (width * height)),
    maxDimension / width,
    maxDimension / height,
  );
  const w = Math.max(1, Math.floor(width * ratio)),
    h = Math.max(1, Math.floor(height * ratio));
  return {
    width: w,
    height: h,
    scaleX: w / width,
    scaleY: h / height,
    requestedDpr: requested,
    effectiveDpr: Math.min(w / width, h / height),
    limited: ratio < requested - 0.001,
  };
}
