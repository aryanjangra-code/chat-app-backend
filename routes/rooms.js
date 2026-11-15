import express from "express";
import mongoose from "mongoose";
import Room from "../models/Room.js";
import Message from "../models/Message.js";
import User from "../models/User.js";
import { protect } from "../middleware/auth.js";

const router = express.Router();
router.use(protect);

// List all group rooms + DM rooms the user belongs to
router.get("/", async (req, res) => {
  const groupRooms = await Room.find({ type: "group" }).sort({ lastMessageAt: -1 });
  const dmRooms = await Room.find({ type: "dm", members: req.userId })
    .populate("members", "username avatarColor isOnline lastSeen")
    .sort({ lastMessageAt: -1 });
  res.json({ groupRooms, dmRooms });
});

// Create a new group room
router.post("/group", async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ message: "Room name required" });
  const room = await Room.create({
    name: name.trim(),
    type: "group",
    members: [req.userId],
    createdBy: req.userId,
  });
  res.status(201).json({ room });
});

// Get or create a DM room with another user
router.post("/dm/:otherUserId", async (req, res) => {
  const { otherUserId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(otherUserId)) {
    return res.status(404).json({ message: "User not found" });
  }
  if (req.userId.toString() === otherUserId) {
    return res.status(400).json({ message: "You cannot start a DM with yourself" });
  }
  const otherUser = await User.findById(otherUserId).select("_id");
  if (!otherUser) return res.status(404).json({ message: "User not found" });

  let room = await Room.findOne({
    type: "dm",
    members: { $all: [req.userId, otherUserId], $size: 2 },
  }).populate("members", "username avatarColor isOnline lastSeen");

  if (!room) {
    room = await Room.create({
      type: "dm",
      members: [req.userId, otherUserId],
    });
    room = await room.populate("members", "username avatarColor isOnline lastSeen");
  }
  res.json({ room });
});

// Join a group room
router.post("/:roomId/join", async (req, res) => {
  const room = await Room.findById(req.params.roomId);
  if (!room) return res.status(404).json({ message: "Room not found" });
  if (!room.members.includes(req.userId)) {
    room.members.push(req.userId);
    await room.save();
  }
  res.json({ room });
});

// Fetch paginated message history for a room
router.get("/:roomId/messages", async (req, res) => {
  const { roomId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(roomId)) {
    return res.status(404).json({ message: "Room not found" });
  }
  const room = await Room.findById(roomId).select("type members");
  if (!room) return res.status(404).json({ message: "Room not found" });
  if (
    room.type === "dm" &&
    !room.members.some((memberId) => memberId.toString() === req.userId.toString())
  ) {
    return res.status(403).json({ message: "You are not a member of this DM" });
  }

  const { before, limit = 30 } = req.query;
  const query = { room: roomId };
  if (before) query.createdAt = { $lt: new Date(before) };

  const messages = await Message.find(query)
    .sort({ createdAt: -1 })
    .limit(Number(limit))
    .populate("sender", "username avatarColor")
    .populate("reactions.user", "username");

  res.json({ messages: messages.reverse() });
});

export default router;
