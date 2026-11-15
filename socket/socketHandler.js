import { verifySocketToken } from "../middleware/auth.js";
import mongoose from "mongoose";
import User from "../models/User.js";
import Room from "../models/Room.js";
import Message from "../models/Message.js";
import { isRoomMember } from "../utils/roomAccess.js";

// userId -> Set of socket ids (a user can have multiple tabs open)
const onlineUsers = new Map();

const findAccessibleRoom = async (roomId, userId) => {
  if (!mongoose.Types.ObjectId.isValid(roomId)) return null;
  const room = await Room.findById(roomId);
  if (!room) return null;
  if (!isRoomMember(room, userId)) {
    return null;
  }
  return room;
};

export const initSocket = (io) => {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    const decoded = token && verifySocketToken(token);
    if (!decoded) return next(new Error("Authentication error"));
    socket.userId = decoded.id;
    next();
  });

  io.on("connection", (socket) => {
    const { userId } = socket;

    if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
    onlineUsers.get(userId).add(socket.id);

    User.findByIdAndUpdate(userId, { isOnline: true }).catch((err) => {
      console.error("Unable to update online status:", err.message);
    });
    socket.broadcast.emit("presence:update", { userId, isOnline: true });

    // --- Room membership ---
    socket.on("room:join", async (roomId, callback) => {
      try {
        if (!(await findAccessibleRoom(roomId, userId))) {
          return callback?.({ ok: false, error: "Room not found or access denied" });
        }
        socket.join(roomId);
        callback?.({ ok: true });
      } catch {
        callback?.({ ok: false, error: "Unable to join room" });
      }
    });

    socket.on("room:leave", (roomId) => {
      socket.leave(roomId);
    });

    // --- Messaging ---
    socket.on("message:send", async (payload, callback) => {
      try {
        const { roomId, text } = payload || {};
        if (typeof text !== "string" || !text.trim() || text.trim().length > 2000) {
          return callback?.({ ok: false, error: "Message must be between 1 and 2000 characters" });
        }
        const room = await findAccessibleRoom(roomId, userId);
        if (!room) return callback?.({ ok: false, error: "Room not found or access denied" });

        const message = await Message.create({
          room: roomId,
          sender: userId,
          text: text.trim(),
        });
        await Room.findByIdAndUpdate(roomId, { lastMessageAt: new Date() });
        const populated = await message.populate("sender", "username avatarColor");

        io.to(roomId).emit("message:new", populated);
        callback?.({ ok: true, message: populated });
      } catch (err) {
        callback?.({ ok: false, error: err.message });
      }
    });

    socket.on("message:react", async (payload) => {
      try {
        const { messageId, emoji } = payload || {};
        if (!mongoose.Types.ObjectId.isValid(messageId) || typeof emoji !== "string" || !emoji.trim()) return;
        const message = await Message.findById(messageId);
        if (!message || !(await findAccessibleRoom(message.room, userId))) return;

        const existingIdx = message.reactions.findIndex(
          (r) => r.user.toString() === userId && r.emoji === emoji
        );
        if (existingIdx > -1) message.reactions.splice(existingIdx, 1);
        else message.reactions.push({ emoji, user: userId });
        await message.save();
        const populated = await message.populate("reactions.user", "username");
        io.to(message.room.toString()).emit("message:reaction-updated", {
          messageId,
          reactions: populated.reactions,
        });
      } catch (err) {
        console.error("Unable to update message reaction:", err.message);
      }
    });

    socket.on("message:edit", async (payload) => {
      try {
        const { messageId, text } = payload || {};
        if (!mongoose.Types.ObjectId.isValid(messageId) || typeof text !== "string" || !text.trim() || text.trim().length > 2000) return;
        const message = await Message.findById(messageId);
        if (!message || message.sender.toString() !== userId) return;
        if (!(await findAccessibleRoom(message.room, userId))) return;
        message.text = text.trim();
        message.edited = true;
        await message.save();
        io.to(message.room.toString()).emit("message:edited", {
          messageId,
          text: message.text,
        });
      } catch (err) {
        console.error("Unable to edit message:", err.message);
      }
    });

    socket.on("message:delete", async ({ messageId }) => {
      const message = await Message.findById(messageId);
      if (!message || message.sender.toString() !== userId) return;
      if (!(await findAccessibleRoom(message.room, userId))) return;
      message.deleted = true;
      message.text = "This message was deleted";
      await message.save();
      io.to(message.room.toString()).emit("message:deleted", { messageId });
    });

    // --- Typing indicators ---
    socket.on("typing:start", async ({ roomId, username }) => {
      if (!(await findAccessibleRoom(roomId, userId))) return;
      socket.to(roomId).emit("typing:update", { roomId, userId, username, isTyping: true });
    });

    socket.on("typing:stop", async ({ roomId, username }) => {
      if (!(await findAccessibleRoom(roomId, userId))) return;
      socket.to(roomId).emit("typing:update", { roomId, userId, username, isTyping: false });
    });

    // --- Disconnect ---
    socket.on("disconnect", async () => {
      const sockets = onlineUsers.get(userId);
      sockets?.delete(socket.id);
      if (!sockets || sockets.size === 0) {
        onlineUsers.delete(userId);
        await User.findByIdAndUpdate(userId, { isOnline: false, lastSeen: new Date() });
        io.emit("presence:update", { userId, isOnline: false, lastSeen: new Date() });
      }
    });
  });
};
