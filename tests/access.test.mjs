import assert from "node:assert/strict";
import { after, test } from "node:test";
import { spawnSync } from "node:child_process";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

process.env.UBUNTU_CONTROL_MODE = "ssh";
process.env.UBUNTU_CONTROL_PUBLIC_ORIGIN = "https://control.example.com";
process.env.UBUNTU_CONTROL_ACCESS_TEAM = "test-team";
process.env.UBUNTU_CONTROL_ACCESS_AUD = "a".repeat(64);
const issuer = "https://test-team.cloudflareaccess.com";
const { privateKey, publicKey } = await generateKeyPair("RS256");
const jwk = { ...await exportJWK(publicKey), kid: "test-key", alg: "RS256", use: "sig" };
const originalFetch = globalThis.fetch;
// Only the external key endpoint is replaced. Signatures and claims use real crypto.
globalThis.fetch = async (url) => {
  assert.equal(String(url), `${issuer}/cdn-cgi/access/certs`);
  return new Response(JSON.stringify({ keys: [jwk] }), { headers: { "content-type": "application/json" } });
};
after(() => { globalThis.fetch = originalFetch; });
const { authorized } = await import("../server/access.ts");

async function token(overrides = {}, key = privateKey) {
  return new SignJWT({ email: "owner@example.com", ...overrides })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(overrides.iss ?? issuer)
    .setAudience(overrides.aud ?? "a".repeat(64))
    .setSubject("owner")
    .setIssuedAt()
    .setExpirationTime(overrides.exp ?? "5m")
    .sign(key);
}

test("requires a signed Access assertion", async () => {
  assert.equal(await authorized({ headers: {} }), false);
  assert.equal(await authorized({ headers: { "cf-access-jwt-assertion": "forged" } }), false);
  assert.equal(await authorized({ headers: { "cf-access-jwt-assertion": await token() } }), true);
});

test("rejects wrong application, issuer, expiration and signature", async () => {
  const other = await generateKeyPair("RS256");
  for (const assertion of [
    await token({ aud: "b".repeat(64) }),
    await token({ iss: "https://other.cloudflareaccess.com" }),
    await token({ exp: 1 }),
    await token({}, other.privateKey),
    await token({ email: null }),
  ]) {
    assert.equal(await authorized({ headers: { "cf-access-jwt-assertion": assertion } }), false);
  }
});

test("default config preserves SSH, public mode fails closed", () => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("UBUNTU_CONTROL_")));
  const run = (extra) => spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
    "import {config} from './server/config.ts'; process.stdout.write(JSON.stringify(config));"],
  { env: { ...env, ...extra }, encoding: "utf8" });
  const defaults = run({});
  assert.equal(defaults.status, 0);
  assert.deepEqual(JSON.parse(defaults.stdout), { mode: "ssh", publicOrigin: null, access: null });
  assert.notEqual(run({ UBUNTU_CONTROL_PUBLIC_ORIGIN: "https://control.example.com" }).status, 0);
  assert.notEqual(run({ UBUNTU_CONTROL_PUBLIC_ORIGIN: "https://control.example.com/bad" }).status, 0);
});
