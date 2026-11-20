
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config/env.js";

export const getTokenFromRequest = (req) => {
  const authorization = req.get("Authorization") || "";

  if (!authorization.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice(7).trim();
};

export const protect = (req, res, next) => {
  const token = getTokenFromRequest(req);

  if (!token) {
    return res.status(401).json({
      message: "Authentication required",
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    if (
      !decoded.id ||
      decoded.type !== "access" ||
      !decoded.sid
    ) {
      return res.status(401).json({
        message: "Invalid authentication token",
      });
    }

    req.userId = decoded.id;
    req.sessionFamilyId = decoded.sid;

    next();
  } catch {
    return res.status(401).json({
      message: "Access token expired or invalid",
    });
  }
};

export const verifySocketToken = (authToken) => {
  try {
    if (!authToken) return null;

    const decoded = jwt.verify(authToken, JWT_SECRET);

    if (
      !decoded.id ||
      decoded.type !== "access" ||
      !decoded.sid
    ) {
      return null;
    }

    return decoded;
  } catch {
    return null;
  }
};
