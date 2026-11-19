import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config/env.js";
import { AUTH_COOKIE } from "../config/cookies.js";

export const parseCookies = (cookieHeader = "") => {
  const cookies = {};
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    try { cookies[key] = decodeURIComponent(value); }
    catch { cookies[key] = value; }
  }
  return cookies;
};

export const getTokenFromRequest = (req) => parseCookies(req.headers.cookie)[AUTH_COOKIE];

export const protect = (req, res, next) => {
  const token = getTokenFromRequest(req);
  if (!token) return res.status(401).json({ message: "Authentication required" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded.id) return res.status(401).json({ message: "Invalid authentication token" });
    req.userId = decoded.id;
    next();
  } catch {
    return res.status(401).json({ message: "Session expired. Please sign in again." });
  }
};

export const verifySocketToken = (cookieHeader) => {
  try {
    const token = parseCookies(cookieHeader)[AUTH_COOKIE];
    if (!token) return null;
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded.id ? decoded : null;
  } catch {
    return null;
  }
};
