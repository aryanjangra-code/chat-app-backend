import express from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import User from "../models/User.js";
import { protect } from "../middleware/auth.js";

const router = express.Router();
const fallbackUsers = [];

// The mistake was treating MongoDB as mandatory for signup. If the database is down or
// unreachable, the request was failing before the user could be created.
const isDbConnected = () => mongoose.connection.readyState === 1;

const ensureUserShape = (user) => {
  if (!user) return null;
  if (typeof user.comparePassword === "function" && typeof user.toSafeObject === "function") {
    return user;
  }

  return {
    ...user,
    comparePassword: function (candidate) {
      return bcrypt.compare(candidate, this.password);
    },
    toSafeObject: function () {
      return {
        id: this._id,
        username: this.username,
        avatarColor: this.avatarColor,
        status: this.status,
        isOnline: this.isOnline,
        lastSeen: this.lastSeen,
      };
    },
  };
};

const findFallbackUserByUsername = async (username) => {
  const normalizedUsername = username?.toLowerCase();
  const existing = fallbackUsers.find((user) => user.username.toLowerCase() === normalizedUsername);
  return ensureUserShape(existing) || null;
};

const findFallbackUserById = async (id) => {
  const existing = fallbackUsers.find((user) => user._id.toString() === id.toString());
  return ensureUserShape(existing) || null;
};

const createFallbackUser = async ({ username, password }) => {
  const hashedPassword = await bcrypt.hash(password, 10);
  const user = {
    _id: randomUUID(),
    username,
    password: hashedPassword,
    avatarColor: `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0")}`,
    status: "Hey there! I'm using GroupChat",
    isOnline: false,
    lastSeen: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  fallbackUsers.push(user);
  return ensureUserShape(user);
};

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

const signToken = (id) => jwt.sign({ id }, JWT_SECRET, { expiresIn: "7d" });

router.post("/signup", async (req, res) => {
  try {
    const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";

    if (!username || !password) {
      return res.status(400).json({ message: "Username and password required" });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    const normalizedUsername = username.toLowerCase();
    let existing;

    if (isDbConnected()) {
      existing = await User.findOne({ username: normalizedUsername });
    } else {
      existing = await findFallbackUserByUsername(normalizedUsername);
    }

    if (existing) {
      return res.status(409).json({ message: "Username already taken" });
    }

    let user;
    if (isDbConnected()) {
      user = await User.create({ username: normalizedUsername, password });
    } else {
      user = await createFallbackUser({ username: normalizedUsername, password });
    }

    const token = signToken(user._id);
    res.status(201).json({ token, user: user.toSafeObject() });
  } catch (err) {
    res.status(500).json({ message: "Signup failed", error: err.message });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    let user;

    if (isDbConnected()) {
      user = await User.findOne({ username: username?.toLowerCase() });
    } else {
      user = await findFallbackUserByUsername(username);
    }

    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ message: "Invalid username or password" });
    }

    if (isDbConnected()) {
      user.isOnline = true;
      await user.save();
    } else {
      user.isOnline = true;
      user.lastSeen = new Date();
    }

    const token = signToken(user._id);
    res.json({ token, user: user.toSafeObject() });
  } catch (err) {
    res.status(500).json({ message: "Login failed", error: err.message });
  }
});

router.get("/me", protect, async (req, res) => {
  let user;

  if (isDbConnected()) {
    user = await User.findById(req.userId);
  } else {
    user = await findFallbackUserById(req.userId);
  }

  if (!user) return res.status(404).json({ message: "User not found" });
  res.json({ user: user.toSafeObject() });
});

router.get("/users", protect, async (req, res) => {
  if (!isDbConnected()) {
    const users = fallbackUsers
      .filter((user) => user._id.toString() !== req.userId.toString())
      .map((user) => ({
        username: user.username,
        avatarColor: user.avatarColor,
        status: user.status,
        isOnline: user.isOnline,
        lastSeen: user.lastSeen,
      }));
    return res.json({ users });
  }

  const users = await User.find({ _id: { $ne: req.userId } }).select(
    "username avatarColor status isOnline lastSeen"
  );
  res.json({ users });
});

export default router;
