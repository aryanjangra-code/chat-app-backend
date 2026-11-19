import express from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import User from "../models/User.js";
import { protect } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { JWT_SECRET } from "../config/env.js";
import { isValidUsername, normalizeUsername } from "../utils/validation.js";
import { AUTH_COOKIE, CSRF_COOKIE, authCookieOptions, csrfCookieOptions, baseCookieOptions } from "../config/cookies.js";
import { authRateLimiter } from "../middleware/rateLimiter.js";

const router = express.Router();
const isDbConnected = () => mongoose.connection.readyState === 1;
const signToken = (id) => jwt.sign({ id }, JWT_SECRET, { expiresIn: "7d" });

const issueSession = (res, user) => {
  const token = signToken(user._id);
  const csrfToken = crypto.randomBytes(32).toString("hex");
  res.cookie(AUTH_COOKIE, token, authCookieOptions);
  res.cookie(CSRF_COOKIE, csrfToken, csrfCookieOptions);
};

const clearSession = (res) => {
  res.clearCookie(AUTH_COOKIE, { ...baseCookieOptions, httpOnly: true });
  res.clearCookie(CSRF_COOKIE, { ...baseCookieOptions, httpOnly: false });
};

router.post("/signup", authRateLimiter, asyncHandler(async (req, res) => {
  if (!isDbConnected()) return res.status(503).json({ message: "Database unavailable" });

  const username = normalizeUsername(req.body?.username);
  const password = typeof req.body?.password === "string" ? req.body.password : "";

  if (!isValidUsername(username)) {
    return res.status(400).json({ message: "Username must be between 3 and 20 characters" });
  }
  if (password.length < 8 || password.length > 72) {
    return res.status(400).json({ message: "Password must be between 8 and 72 characters" });
  }

  try {
    const user = await User.create({ username, password });
    issueSession(res, user);
    return res.status(201).json({ user: user.toSafeObject() });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: "Username already taken" });
    if (err instanceof mongoose.Error.ValidationError) {
      return res.status(400).json({ message: "Invalid account details" });
    }
    throw err;
  }
}));

router.post("/login", authRateLimiter, asyncHandler(async (req, res) => {
  if (!isDbConnected()) return res.status(503).json({ message: "Database unavailable" });

  const username = normalizeUsername(req.body?.username);
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!username || !password || password.length > 72) {
    return res.status(400).json({ message: "Username and password are required" });
  }

  const user = await User.findOne({ username });
  if (!user || !(await user.comparePassword(password))) {
    return res.status(401).json({ message: "Invalid username or password" });
  }

  user.isOnline = true;
  await user.save();
  issueSession(res, user);
  res.json({ user: user.toSafeObject() });
}));

router.post("/logout", protect, asyncHandler(async (req, res) => {
  await User.findByIdAndUpdate(req.userId, { isOnline: false, lastSeen: new Date() });
  clearSession(res);
  res.status(200).json({ message: "Logged out successfully" });
}));

router.get("/me", protect, asyncHandler(async (req, res) => {
  if (!isDbConnected()) return res.status(503).json({ message: "Database unavailable" });
  const user = await User.findById(req.userId);
  if (!user) return res.status(404).json({ message: "User not found" });
  res.json({ user: user.toSafeObject() });
}));

router.get("/users", protect, asyncHandler(async (req, res) => {
  if (!isDbConnected()) return res.status(503).json({ message: "Database unavailable" });
  const users = await User.find({ _id: { $ne: req.userId } })
    .select("username avatarColor status isOnline lastSeen");
  res.json({ users });
}));

export default router;
