import express from "express";
import http from "http";
import cors from "cors";
import mongoose from "mongoose";
import { Server } from "socket.io";

import "./config/env.js";
import { connectDB } from "./config/db.js";
import { csrfProtection } from "./middleware/csrf.js";
import authRoutes from "./routes/auth.js";
import roomRoutes from "./routes/rooms.js";
import { initSocket } from "./socket/socketHandler.js";

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;

const allowedOrigins = new Set(
  (process.env.CLIENT_URL || "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean)
);

const isAllowedOrigin = (origin) => !origin || allowedOrigins.has(origin.replace(/\/+$/, ""));

app.set("trust proxy", 1);
app.use(cors({
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) return callback(null, true);
    return callback(new Error("Origin not allowed by CORS"));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "X-CSRF-Token"],
}));
app.use(express.json({ limit: "20kb" }));

app.use((req, res, next) => {
  const origin = req.get("Origin");
  if (!isAllowedOrigin(origin)) {
    return res.status(403).json({ message: "Request origin not allowed" });
  }
  next();
});

app.use("/api", csrfProtection);
app.use("/api/auth", authRoutes);
app.use("/api/rooms", roomRoutes);

app.get("/api/health", (req, res) => {
  const dbReady = mongoose.connection.readyState === 1;
  res.status(dbReady ? 200 : 503).json({
    status: dbReady ? "ok" : "not_ready",
    database: dbReady ? "connected" : "disconnected",
  });
});

app.use((err, req, res, next) => {
  console.error("Request failed:", err.message);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({
    message: err.status && err.status < 500 ? err.message : "Internal server error",
  });
});

const io = new Server(server, {
  cors: { origin: [...allowedOrigins], credentials: true, methods: ["GET", "POST"] },
  allowRequest: (req, callback) => callback(null, isAllowedOrigin(req.headers.origin)),
});
initSocket(io);

async function start() {
  await connectDB();
  server.listen(PORT, () => console.log(`API and Socket.IO server listening on ${PORT}`));
}

start().catch((error) => {
  console.error("Server startup failed:", error.message);
  process.exit(1);
});
