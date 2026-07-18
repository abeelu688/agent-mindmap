import { createHash } from "crypto";

export function sha256Hex(data: string | Buffer): string {
  const h = createHash("sha256");
  h.update(data);
  return h.digest("hex");
}
