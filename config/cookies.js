const isProduction = process.env.NODE_ENV === "production";
const sameSite = (process.env.COOKIE_SAME_SITE || (isProduction ? "none" : "lax")).toLowerCase();

if (!["lax", "strict", "none"].includes(sameSite)) {
  throw new Error("COOKIE_SAME_SITE must be lax, strict, or none");
}
if (sameSite === "none" && !isProduction) {
  // SameSite=None requires Secure cookies in modern browsers.
  // Use HTTPS locally if you explicitly choose this mode.
}

export const AUTH_COOKIE = "gc_token";
export const CSRF_COOKIE = "gc_csrf";

export const baseCookieOptions = {
  path: "/",
  secure: isProduction || sameSite === "none",
  sameSite,
  ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
};

export const authCookieOptions = {
  ...baseCookieOptions,
  httpOnly: true,
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

export const csrfCookieOptions = {
  ...baseCookieOptions,
  httpOnly: false,
  maxAge: 7 * 24 * 60 * 60 * 1000,
};
