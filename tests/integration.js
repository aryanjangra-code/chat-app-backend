import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { io } from "socket.io-client";
import "../config/env.js";
import Message from "../models/Message.js";
import Room from "../models/Room.js";
import User from "../models/User.js";

const baseUrl = process.env.TEST_BASE_URL || "http://127.0.0.1:5000";
const testPassword = `T-${randomUUID()}-pass`;
const testPrefix = `qa${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const userIds = [];
const roomIds = [];
const sockets = [];

const request = async (path, { token, ...options } = {}) => {
  const response = await fetch(`${baseUrl}/api${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const data = await response.json();
  return { response, data };
};

const createUser = async (suffix) => {
  const { response, data } = await request("/auth/signup", {
    method: "POST",
    body: JSON.stringify({ username: `${testPrefix}${suffix}`, password: testPassword }),
  });
  assert.equal(response.status, 201, JSON.stringify(data));
  userIds.push(data.user.id);
  return {
  ...data,
  token: data.accessToken,
};
};

const connectSocket = (token) => new Promise((resolve, reject) => {
  const socket = io(baseUrl, { auth: { token }, reconnection: false, timeout: 5000 });
  sockets.push(socket);
  socket.once("connect", () => resolve(socket));
  socket.once("connect_error", reject);
});

const emitWithAck = (socket, event, ...args) => new Promise((resolve, reject) => {
  console.log(`Awaiting ${event} acknowledgement`);
  const timer = setTimeout(() => reject(new Error(`${event} acknowledgement timed out`)), 15000);
  socket.emit(event, ...args, (result) => {
    clearTimeout(timer);
    console.log(`${event} acknowledgement: ${result?.ok ? "ok" : "denied"}`);
    resolve(result);
  });
});

const waitForEvent = (socket, event, predicate) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    socket.off(event, onEvent);
    reject(new Error(`${event} event timed out`));
  }, 5000);
  const onEvent = (payload) => {
    if (!predicate(payload)) return;
    clearTimeout(timer);
    socket.off(event, onEvent);
    resolve(payload);
  };
  socket.on(event, onEvent);
});

let connectedToDatabase = false;

try {
  assert.ok(process.env.MONGO_URI, "MONGO_URI must be configured for integration tests");
  await mongoose.connect(process.env.MONGO_URI);
  connectedToDatabase = true;

  const invalidSignup = await request("/auth/signup", {
    method: "POST",
    body: JSON.stringify({ username: "ab", password: testPassword }),
  });
  assert.equal(invalidSignup.response.status, 400);

  const [owner, member, outsider] = await Promise.all([
    createUser("a"),
    createUser("b"),
    createUser("c"),
  ]);

  const me = await request("/auth/me", { token: owner.token });
  assert.equal(me.response.status, 200);
  assert.equal(me.data.user.id, owner.user.id);

  const login = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username: owner.user.username.toUpperCase(), password: testPassword }),
  });
  assert.equal(login.response.status, 200);
  assert.equal(login.data.user.id, owner.user.id);
  const oldRefreshToken = owner.refreshToken;

const rotated = await request("/auth/refresh", {
  method: "POST",
  body: JSON.stringify({
    refreshToken: oldRefreshToken,
  }),
});

assert.equal(rotated.response.status, 200);
assert.ok(rotated.data.accessToken);
assert.ok(rotated.data.refreshToken);

assert.notEqual(
  rotated.data.refreshToken,
  oldRefreshToken
);

// Use the newly issued access token for the remaining tests.
owner.token = rotated.data.accessToken;
owner.refreshToken = rotated.data.refreshToken;

  const duplicate = await request("/auth/signup", {
    method: "POST",
    body: JSON.stringify({ username: `${testPrefix}A`.toUpperCase(), password: testPassword }),
  });
  assert.equal(duplicate.response.status, 409);

  const createdRoom = await request("/rooms/group", {
    token: owner.token,
    method: "POST",
    body: JSON.stringify({ name: `${testPrefix}-group` }),
  });
  assert.equal(createdRoom.response.status, 201);
  const groupId = createdRoom.data.room._id;
  roomIds.push(groupId);

  const outsiderHistory = await request(`/rooms/${groupId}/messages`, { token: outsider.token });
  assert.equal(outsiderHistory.response.status, 403);

  const ownerSocket = await connectSocket(owner.token);
  const outsiderSocket = await connectSocket(outsider.token);
  assert.equal((await emitWithAck(outsiderSocket, "room:join", groupId)).ok, false);
  assert.equal(
    (await emitWithAck(outsiderSocket, "message:send", { roomId: groupId, text: "blocked" })).ok,
    false
  );

  const joined = await request(`/rooms/${groupId}/join`, { token: member.token, method: "POST" });
  assert.equal(joined.response.status, 200);
  const memberSocket = await connectSocket(member.token);
  assert.equal((await emitWithAck(memberSocket, "room:join", groupId)).ok, true);
  assert.equal((await emitWithAck(ownerSocket, "room:join", groupId)).ok, true);

  const receivedGroupMessage = waitForEvent(memberSocket, "message:new", (message) => message.room === groupId);
  const groupMessage = await emitWithAck(ownerSocket, "message:send", {
    roomId: groupId,
    text: "integration group message",
  });
  assert.equal(groupMessage.ok, true);
  assert.equal((await receivedGroupMessage).text, "integration group message");

  const groupHistory = await request(`/rooms/${groupId}/messages?limit=1000`, { token: member.token });
  assert.equal(groupHistory.response.status, 200);
  assert.ok(groupHistory.data.messages.length <= 100);
  assert.ok(groupHistory.data.messages.some((message) => message.text === "integration group message"));
  assert.equal((await request(`/rooms/${groupId}/messages?limit=invalid`, { token: member.token })).response.status, 400);
  assert.equal((await request(`/rooms/${groupId}/messages?before=invalid`, { token: member.token })).response.status, 400);

  const createdDm = await request(`/rooms/dm/${member.user.id}`, { token: owner.token, method: "POST" });
  assert.equal(createdDm.response.status, 200);
  const dmId = createdDm.data.room._id;
  roomIds.push(dmId);
  assert.equal((await request(`/rooms/${dmId}/messages`, { token: outsider.token })).response.status, 403);
  const dmJoinAttempt = await request(`/rooms/${dmId}/join`, { token: outsider.token, method: "POST" });
  assert.equal(dmJoinAttempt.response.status, 400);

  assert.equal((await emitWithAck(outsiderSocket, "room:join", dmId)).ok, false);
  assert.equal((await emitWithAck(ownerSocket, "room:join", dmId)).ok, true);
  assert.equal((await emitWithAck(memberSocket, "room:join", dmId)).ok, true);
  const receivedDmMessage = waitForEvent(memberSocket, "message:new", (message) => message.room === dmId);
  const dmMessage = await emitWithAck(ownerSocket, "message:send", {
    roomId: dmId,
    text: "integration direct message",
  });
  assert.equal(dmMessage.ok, true);
  assert.equal((await receivedDmMessage).text, "integration direct message");

  console.log("Integration checks passed: signup/login, group and DM access, pagination, and realtime messages.");
} finally {
  for (const socket of sockets) socket.disconnect();
  if (connectedToDatabase) {
    await Message.deleteMany({ room: { $in: roomIds } });
    await Room.deleteMany({ _id: { $in: roomIds } });
    await User.deleteMany({ _id: { $in: userIds } });
    await mongoose.disconnect();
  }
  const reusedToken = await request("/auth/refresh", {
  method: "POST",
  body: JSON.stringify({
    refreshToken: oldRefreshToken,
  }),
});

assert.equal(reusedToken.response.status, 401);
}