const ROLES = ["viewer", "editor", "owner"];

function normalizeRole(role) {
  if (!role || !ROLES.includes(role)) return "viewer";
  return role;
}

export function requireRole(allowedRoles) {
  const allowed = new Set(allowedRoles.map(normalizeRole));
  return (req, res, next) => {
    const role = normalizeRole(req.user?.role);
    if (!allowed.has(role)) {
      return res.status(403).json({
        error: "Forbidden",
        message: `Role "${role}" does not have permission for this action`,
      });
    }
    return next();
  };
}

export const Roles = Object.freeze({
  VIEWER: "viewer",
  EDITOR: "editor",
  OWNER: "owner",
});
