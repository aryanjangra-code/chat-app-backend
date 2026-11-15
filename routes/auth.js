import express from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import User from "../models/User.js";
import { protect } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { JWT_SECRET } from "../config/env.js";
import { isValidUsername, normalizeUsername } from "../utils/validation.js";

const router = express.Router();
const isDbConnected = () => mongoose.connection.readyState === 1;

const signToken = (id) => jwt.sign({ id }, JWT_SECRET, { expiresIn: "7d" });

router.post("/signup", asyncHandler(async (req, res) => {
  try {
    const username = normalizeUsername(req.body?.username);
    const password = typeof req.body?.password === "string" ? req.body.password : "";

    if (!isDbConnected()) return res.status(503).json({ message: "Database unavailable" });
    if (!isValidUsername(username) || !password) {
      return res.status(400).json({ message: "Username and password required" });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    const normalizedUsername = username.toLowerCase();
    const existing = await User.findOne({ username: normalizedUsername });

    if (existing) {
      return res.status(409).json({ message: "Username already taken" });
    }

    const user = await User.create({ username: normalizedUsername, password });

    const token = signToken(user._id);
    res.status(201).json({ token, user: user.toSafeObject() });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: "Username already taken" });
    if (err instanceof mongoose.Error.ValidationError) {
      return res.status(400).json({ message: "Invalid account details" });
    }
    throw err;
  }
}));

router.post("/login", asyncHandler(async (req, res) => {
  try {
    if (!isDbConnected()) return res.status(503).json({ message: "Database unavailable" });
    const username = normalizeUsername(req.body?.username);
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const user = await User.findOne({ username });

    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ message: "Invalid username or password" });
    }

    user.isOnline = true;
    await user.save();

    const token = signToken(user._id);
    res.json({ token, user: user.toSafeObject() });
  } catch (err) {
    throw err;
  }
}));

router.get("/me", protect, asyncHandler(async (req, res) => {
  if (!isDbConnected()) return res.status(503).json({ message: "Database unavailable" });
  const user = await User.findById(req.userId);

  if (!user) return res.status(404).json({ message: "User not found" });
  res.json({ user: user.toSafeObject() });
}));

router.get("/users", protect, asyncHandler(async (req, res) => {
  if (!isDbConnected()) return res.status(503).json({ message: "Database unavailable" });

  const users = await User.find({ _id: { $ne: req.userId } }).select(
    "username avatarColor status isOnline lastSeen"
  );
  res.json({ users });
}));

export default router;
