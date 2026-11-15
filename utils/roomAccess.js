export const isRoomMember = (room, userId) =>
  room.members.some((memberId) => memberId.toString() === userId.toString());