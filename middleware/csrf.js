import crypto from "crypto";
import { CSRF_COOKIE } from "../config/cookies.js";
import { parseCookies } from "./auth.js";

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

export const csrfProtection = (req, res, next) => {
  if (safeMethods.has(req.method)) return next();

  // Login/signup have no established CSRF cookie yet. Their Origin is checked
  // by the global originGuard middleware in server.js.
  if (req.path === "/auth/login" || req.path === "/auth/signup") return next();

  if (req.get("Authorization")?.startsWith("Bearer ")) return next();

  const cookieToken = parseCookies(req.headers.cookie)[CSRF_COOKIE];
  const headerToken = req.get("X-CSRF-Token");

  if (!cookieToken || !headerToken) {
    return res.status(403).json({ message: "CSRF validation failed. Refresh and try again." });
  }

  const a = Buffer.from(cookieToken);
  const b = Buffer.from(headerToken);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).json({ message: "CSRF validation failed. Refresh and try again." });
  }
  next();
};
