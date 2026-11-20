
import express from "express";
import crypto, { randomUUID } from "crypto";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

import User from "../models/User.js";
import RefreshSession from "../models/RefreshSession.js";

import { protect } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { JWT_SECRET } from "../config/env.js";
import { isValidUsername, normalizeUsername } from "../utils/validation.js";
import { authRateLimiter } from "../middleware/rateLimiter.js";

const router = express.Router();

const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const isDbConnected = () => mongoose.connection.readyState === 1;

const hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

const createTokenPair = async (
  userId,
  familyId = randomUUID(),
  expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS)
) => {
  const accessToken = jwt.sign(
    {
      id: userId.toString(),
      sid: familyId,
      type: "access",
    },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL }
  );

  const refreshToken = crypto.randomBytes(48).toString("base64url");

  await RefreshSession.create({
    user: userId,
    familyId,
    tokenHash: hashToken(refreshToken),
    expiresAt,
  });

  return { accessToken, refreshToken };
};

const revokeTokenFamily = async (familyId) => {
  await RefreshSession.updateMany(
    { familyId, revokedAt: null },
    { $set: { revokedAt: new Date() } }
  );
};

// SIGNUP
router.post("/signup", authRateLimiter, asyncHandler(async (req, res) => {
  if (!isDbConnected()) {
    return res.status(503).json({
      message: "Database unavailable",
    });
  }

  const username = normalizeUsername(req.body?.username);
  const password =
    typeof req.body?.password === "string"
      ? req.body.password
      : "";

  if (!isValidUsername(username)) {
    return res.status(400).json({
      message: "Username must be between 3 and 20 characters",
    });
  }

  if (password.length < 8 || password.length > 72) {
    return res.status(400).json({
      message: "Password must be between 8 and 72 characters",
    });
  }

  try {
    const user = await User.create({ username, password });
    const tokens = await createTokenPair(user._id);

    return res.status(201).json({
      user: user.toSafeObject(),
      ...tokens,
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        message: "Username already taken",
      });
    }

    if (err instanceof mongoose.Error.ValidationError) {
      return res.status(400).json({
        message: "Invalid account details",
      });
    }

    throw err;
  }
}));

// LOGIN
router.post("/login", authRateLimiter, asyncHandler(async (req, res) => {
  if (!isDbConnected()) {
    return res.status(503).json({
      message: "Database unavailable",
    });
  }

  const username = normalizeUsername(req.body?.username);
  const password =
    typeof req.body?.password === "string"
      ? req.body.password
      : "";

  if (!username || !password || password.length > 72) {
    return res.status(400).json({
      message: "Username and password are required",
    });
  }

  const user = await User.findOne({ username });

  if (!user || !(await user.comparePassword(password))) {
    return res.status(401).json({
      message: "Invalid username or password",
    });
  }

  user.isOnline = true;
  await user.save();

  const tokens = await createTokenPair(user._id);

  res.json({
    user: user.toSafeObject(),
    ...tokens,
  });
}));

// REFRESH TOKEN ROTATION
router.post("/refresh", authRateLimiter, asyncHandler(async (req, res) => {
  const refreshToken = req.body?.refreshToken;

  if (
    typeof refreshToken !== "string" ||
    refreshToken.length < 40 ||
    refreshToken.length > 256
  ) {
    return res.status(401).json({
      message: "Invalid refresh token",
    });
  }

  const tokenHash = hashToken(refreshToken);

  const existingSession = await RefreshSession.findOne({
    tokenHash,
  });

  if (!existingSession) {
    return res.status(401).json({
      message: "Refresh session not found",
    });
  }

  // Reusing a rotated token revokes its entire family.
  if (existingSession.revokedAt) {
    await revokeTokenFamily(existingSession.familyId);

    return res.status(401).json({
      message: "Refresh token reuse detected. Please sign in again.",
    });
  }

  const now = new Date();

  if (existingSession.expiresAt <= now) {
    await revokeTokenFamily(existingSession.familyId);

    return res.status(401).json({
      message: "Refresh session expired. Please sign in again.",
    });
  }

  // Atomically consume the old refresh token.
  const claimedSession = await RefreshSession.findOneAndUpdate(
    {
      _id: existingSession._id,
      revokedAt: null,
      expiresAt: { $gt: now },
    },
    {
      $set: { revokedAt: now },
    },
    { new: true }
  );

  if (!claimedSession) {
    await revokeTokenFamily(existingSession.familyId);

    return res.status(401).json({
      message: "Refresh token is no longer valid",
    });
  }

  const user = await User.findById(existingSession.user);

  if (!user) {
    await revokeTokenFamily(existingSession.familyId);

    return res.status(401).json({
      message: "User account no longer exists",
    });
  }

  const tokens = await createTokenPair(
    user._id,
    existingSession.familyId,
    existingSession.expiresAt
  );

  res.json({
    user: user.toSafeObject(),
    ...tokens,
  });
}));

// LOGOUT
router.post("/logout", protect, asyncHandler(async (req, res) => {
  await revokeTokenFamily(req.sessionFamilyId);

  await User.findByIdAndUpdate(req.userId, {
    isOnline: false,
    lastSeen: new Date(),
  });

  res.status(200).json({
    message: "Logged out successfully",
  });
}));

// CURRENT USER
router.get("/me", protect, asyncHandler(async (req, res) => {
  if (!isDbConnected()) {
    return res.status(503).json({
      message: "Database unavailable",
    });
  }

  const user = await User.findById(req.userId);

  if (!user) {
    return res.status(404).json({
      message: "User not found",
    });
  }

  res.json({
    user: user.toSafeObject(),
  });
}));

// ALL USERS
router.get("/users", protect, asyncHandler(async (req, res) => {
  if (!isDbConnected()) {
    return res.status(503).json({
      message: "Database unavailable",
    });
  }

  const users = await User.find({
    _id: { $ne: req.userId },
  }).select("username avatarColor status isOnline lastSeen");

  res.json({ users });
}));

export default router;
