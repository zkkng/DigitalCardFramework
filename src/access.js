/** Trusted server principals only. Never populate this object from request JSON. */
export const PERMISSIONS = Object.freeze([
  "catalog.read",
  "catalog.preview",
  "catalog.publish",
  "accounts.register",
  "currency.grant",
  "currency.settle",
  "audit.read",
  "events.read",
  "maintenance.run",
  "codes.manage",
  "codes.import",
  "codes.confirm",
  "art.import",
  "art.review",
  "art.publish",
  "art.moderate",
]);
export function hasPermission(actor, permission) {
  return (
    !!actor &&
    actor.disabled !== true &&
    PERMISSIONS.includes(permission) &&
    (actor.role === "admin" ||
      (Array.isArray(actor.permissions) &&
        actor.permissions.includes(permission)))
  );
}
export function publicPermissions(actor) {
  return PERMISSIONS.filter((permission) => hasPermission(actor, permission));
}
/** Default authoring-store policy: creators can inspect their own jobs; reviewers all jobs. */
export function authorizePresentation(actor, action, resource) {
  if (!actor?.id || actor.disabled === true) return false;
  if (action === "import") return hasPermission(actor, "art.import");
  if (action === "read-import" || action === "cancel-import")
    return (
      hasPermission(actor, "art.review") ||
      (hasPermission(actor, "art.import") && resource?.actor === actor.id)
    );
  if (action === "publish") return hasPermission(actor, "art.publish");
  if (action === "moderate") return hasPermission(actor, "art.moderate");
  return false;
}
