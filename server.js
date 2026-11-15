import express from "express";
import http from "http";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { Server } from "socket.io";

import { connectDB } from "./config/db.js";
import authRoutes from "./routes/auth.js";
import roomRoutes from "./routes/rooms.js";
import { initSocket } from "./socket/socketHandler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, ".env") });
const clientBuildPath = path.resolve(__dirname, "../frontend/dist");

if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = "dev-secret-change-me";
}

const app = express();
const server = http.createServer(app);

const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";

app.use(cors({ origin: CLIENT_URL }));
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/rooms", roomRoutes);

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

app.use(express.static(clientBuildPath));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(clientBuildPath, "index.html"), (error) => {
    if (error) next();
  });
});

const io = new Server(server, {
  cors: { origin: CLIENT_URL, methods: ["GET", "POST"] },
});
initSocket(io);

const PORT = process.env.PORT || 5000;

connectDB().finally(() => {
  server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});
