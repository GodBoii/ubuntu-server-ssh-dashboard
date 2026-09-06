import type { IncomingMessage } from "node:http";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { config } from "./config.js";

const access = config.access;
const keys = access ? createRemoteJWKSet(new URL(`${access.issuer}/cdn-cgi/access/certs`)) : null;

/** Authenticate HTTP and WebSocket requests, including requests straight to the origin. */
export async function authorized(request: IncomingMessage): Promise<boolean> {
  if (!access || !keys) return true;
  const assertion = request.headers["cf-access-jwt-assertion"];
  if (typeof assertion !== "string") return false;
  try {
    const { payload } = await jwtVerify(assertion, keys, {
      issuer: access.issuer,
      audience: access.audience,
      algorithms: ["RS256"],
      requiredClaims: ["exp", "iat", "sub"],
    });
    return typeof payload.email === "string" && payload.email.length > 0;
  } catch {
    return false;
  }
}
