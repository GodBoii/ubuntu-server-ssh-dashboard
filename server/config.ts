import { z } from "zod";

const environment = z.object({
  UBUNTU_CONTROL_MODE: z.enum(["ssh", "local"]).default("ssh"),
  UBUNTU_CONTROL_PUBLIC_ORIGIN: z.string().url().optional(),
  UBUNTU_CONTROL_ACCESS_TEAM: z.string().regex(/^[a-z0-9-]+$/).optional(),
  UBUNTU_CONTROL_ACCESS_AUD: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).parse(process.env);

const publicUrl = environment.UBUNTU_CONTROL_PUBLIC_ORIGIN
  ? new URL(environment.UBUNTU_CONTROL_PUBLIC_ORIGIN)
  : null;
if (publicUrl && (publicUrl.protocol !== "https:" || publicUrl.username || publicUrl.password
  || publicUrl.pathname !== "/" || publicUrl.search || publicUrl.hash)) {
  throw new Error("UBUNTU_CONTROL_PUBLIC_ORIGIN must be an HTTPS origin without a path or credentials");
}
if (publicUrl && (!environment.UBUNTU_CONTROL_ACCESS_TEAM || !environment.UBUNTU_CONTROL_ACCESS_AUD)) {
  throw new Error("Public access requires both Cloudflare Access team and application audience");
}
if (environment.UBUNTU_CONTROL_MODE === "local" && process.platform !== "linux") {
  throw new Error("Local execution mode is supported only on the Ubuntu host");
}

export const config = {
  mode: environment.UBUNTU_CONTROL_MODE,
  publicOrigin: publicUrl?.origin ?? null,
  access: publicUrl && environment.UBUNTU_CONTROL_ACCESS_TEAM && environment.UBUNTU_CONTROL_ACCESS_AUD
    ? {
      issuer: `https://${environment.UBUNTU_CONTROL_ACCESS_TEAM}.cloudflareaccess.com`,
      audience: environment.UBUNTU_CONTROL_ACCESS_AUD,
    }
    : null,
};
