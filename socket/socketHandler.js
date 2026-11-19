import { verifySocketToken } from "../middleware/auth.js";
import mongoose from "mongoose";
import User from "../models/User.js";
import Room from "../models/Room.js";
import Message from "../models/Message.js";
import { isRoomMember } from "../utils/roomAccess.js";

const onlineUsers = new Map();

const findAccessibleRoom = async (roomId, userId) => {
  if (typeof roomId !== "string" || !mongoose.Types.ObjectId.isValid(roomId)) return null;
  const room = await Room.findById(roomId);
  return room && isRoomMember(room, userId) ? room : null;
};

export const initSocket = (io) => {
  io.use(async (socket, next) => {
    try {
      const decoded = verifySocketToken(socket.handshake.headers.cookie || "");
      if (!decoded) return next(new Error("Authentication required"));
      const user = await User.findById(decoded.id).select("username");
      if (!user) return next(new Error("User account not found"));
      socket.userId = decoded.id;
      socket.data.username = user.username;
      next();
    } catch {
      next(new Error("Socket authentication failed"));
    }
  });

  io.on("connection", (socket) => {
    const { userId } = socket;
    if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
    onlineUsers.get(userId).add(socket.id);

    User.findByIdAndUpdate(userId, { isOnline: true }).catch((err) => {
      console.error("Unable to update online status:", err.message);
    });
    socket.broadcast.emit("presence:update", { userId, isOnline: true });

    socket.on("room:join", async (roomId, callback) => {
      try {
        if (!(await findAccessibleRoom(roomId, userId))) {
          return callback?.({ ok: false, error: "Room not found or access denied" });
        }
        await socket.join(roomId);
        callback?.({ ok: true });
      } catch {
        callback?.({ ok: false, error: "Unable to join room" });
      }
    });

    socket.on("room:leave", (roomId) => {
      if (typeof roomId === "string") socket.leave(roomId);
    });

    socket.on("message:send", async (payload, callback) => {
      try {
        const { roomId, text } = payload || {};
        if (typeof text !== "string" || !text.trim() || text.trim().length > 2000) {
          return callback?.({ ok: false, error: "Message must be between 1 and 2000 characters" });
        }
        const room = await findAccessibleRoom(roomId, userId);
        if (!room) return callback?.({ ok: false, error: "Room not found or access denied" });

        const message = await Message.create({ room: roomId, sender: userId, text: text.trim() });
        await Room.findByIdAndUpdate(roomId, { lastMessageAt: new Date() });
        const populated = await message.populate("sender", "username avatarColor");
        io.to(roomId).emit("message:new", populated);
        callback?.({ ok: true, message: populated });
      } catch (err) {
        callback?.({ ok: false, error: "Unable to send message" });
      }
    });

    socket.on("message:react", async (payload) => {
      try {
        const { messageId, emoji } = payload || {};
        if (!mongoose.Types.ObjectId.isValid(messageId) || typeof emoji !== "string" || !emoji.trim() || emoji.length > 16) return;
        const message = await Message.findById(messageId);
        if (!message || !(await findAccessibleRoom(message.room.toString(), userId))) return;
        const index = message.reactions.findIndex((reaction) => reaction.user.toString() === userId && reaction.emoji === emoji);
        if (index >= 0) message.reactions.splice(index, 1);
        else if (message.reactions.length < 100) message.reactions.push({ emoji, user: userId });
        await message.save();
        const populated = await message.populate("reactions.user", "username");
        io.to(message.room.toString()).emit("message:reaction-updated", { messageId, reactions: populated.reactions });
      } catch (err) {
        console.error("Unable to update reaction:", err.message);
      }
    });

    socket.on("message:edit", async (payload) => {
      try {
        const { messageId, text } = payload || {};
        if (!mongoose.Types.ObjectId.isValid(messageId) || typeof text !== "string" || !text.trim() || text.trim().length > 2000) return;
        const message = await Message.findById(messageId);
        if (!message || message.sender.toString() !== userId) return;
        if (!(await findAccessibleRoom(message.room.toString(), userId))) return;
        message.text = text.trim();
        message.edited = true;
        await message.save();
        io.to(message.room.toString()).emit("message:edited", { messageId, text: message.text });
      } catch (err) {
        console.error("Unable to edit message:", err.message);
      }
    });

    socket.on("message:delete", async (payload) => {
      try {
        const messageId = payload?.messageId;
        if (!mongoose.Types.ObjectId.isValid(messageId)) return;
        const message = await Message.findById(messageId);
        if (!message || message.sender.toString() !== userId) return;
        if (!(await findAccessibleRoom(message.room.toString(), userId))) return;
        message.deleted = true;
        message.text = "This message was deleted";
        await message.save();
        io.to(message.room.toString()).emit("message:deleted", { messageId });
      } catch (err) {
        console.error("Unable to delete message:", err.message);
      }
    });

    const handleTyping = async (payload, isTyping) => {
      try {
        const roomId = payload?.roomId;
        if (!(await findAccessibleRoom(roomId, userId))) return;
        socket.to(roomId).emit("typing:update", {
          roomId,
          userId,
          username: socket.data.username,
          isTyping,
        });
      } catch (err) {
        console.error("Unable to update typing state:", err.message);
      }
    };
    socket.on("typing:start", (payload) => handleTyping(payload, true));
    socket.on("typing:stop", (payload) => handleTyping(payload, false));

    socket.on("disconnect", async () => {
      try {
        const sockets = onlineUsers.get(userId);
        sockets?.delete(socket.id);
        if (!sockets || sockets.size === 0) {
          onlineUsers.delete(userId);
          const lastSeen = new Date();
          await User.findByIdAndUpdate(userId, { isOnline: false, lastSeen });
          io.emit("presence:update", { userId, isOnline: false, lastSeen });
        }
      } catch (err) {
        console.error("Unable to update disconnect presence:", err.message);
      }
    });
  });
};
