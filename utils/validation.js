export const normalizeUsername = (username) =>
  typeof username === "string" ? username.trim().toLowerCase() : "";

export const isValidUsername = (username) => username.length >= 3 && username.length <= 20;

export const parseMessageLimit = (value) => {
  if (value === undefined) return 30;
  if (!/^\d+$/.test(String(value))) return null;

  const limit = Number(value);
  return limit >= 1 ? Math.min(limit, 100) : null;
};

export const parseBeforeDate = (value) => {
  if (value === undefined) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};