import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import { JWT_SECRET } from "../config/env.js";
import { isRoomMember } from "../utils/roomAccess.js";
import {
  isValidUsername,
  normalizeUsername,
  parseBeforeDate,
  parseMessageLimit,
} from "../utils/validation.js";

test("JWT uses the configured secret rather than a development fallback", () => {
  assert.ok(process.env.JWT_SECRET);
  const token = jwt.sign({ id: "test-user" }, JWT_SECRET);
  assert.equal(jwt.verify(token, process.env.JWT_SECRET).id, "test-user");
});

test("username normalization and bounds match the user schema", () => {
  assert.equal(normalizeUsername("  Alice  "), "alice");
  assert.equal(isValidUsername("ab"), false);
  assert.equal(isValidUsername("abc"), true);
  assert.equal(isValidUsername("a".repeat(20)), true);
  assert.equal(isValidUsername("a".repeat(21)), false);
});

test("room membership compares ObjectIds and serialized ids consistently", () => {
  const room = { members: [{ toString: () => "member-1" }] };
  assert.equal(isRoomMember(room, "member-1"), true);
  assert.equal(isRoomMember(room, "member-2"), false);
});

test("message pagination bounds limits and rejects malformed cursors", () => {
  assert.equal(parseMessageLimit(undefined), 30);
  assert.equal(parseMessageLimit("1000"), 100);
  assert.equal(parseMessageLimit("0"), null);
  assert.equal(parseMessageLimit("2.5"), null);
  assert.equal(parseBeforeDate("not-a-date"), null);
  assert.ok(parseBeforeDate("2026-01-01T00:00:00.000Z") instanceof Date);
});