import type { IncomingHttpHeaders } from 'http';

/**
 * Anything request-shaped enough to carry a client address. Typed structurally so this
 * accepts both express's Request and the augmented one in types/express, which are not
 * assignable to each other.
 */
interface RequestLike {
  headers: IncomingHttpHeaders;
  ip?: string | undefined;
}

/**
 * The visitor's address.
 *
 * Cloudflare overwrites CF-Connecting-IP on every request it proxies, so a client cannot
 * forge it through the edge. That guarantee holds only because the ALB security group
 * refuses connections from anywhere except Cloudflare's ranges — if the origin is ever
 * reachable directly again, this header becomes attacker-controlled and any IP-keyed rate
 * limit built on it can be bypassed.
 *
 * Falls back to req.ip (resolved through `trust proxy`) for the ALB health check and any
 * other path that doesn't arrive via the edge.
 */
export const clientIp = (req: RequestLike): string => {
  const header = req.headers['cf-connecting-ip'];
  const connecting = Array.isArray(header) ? header[0] : header;
  return connecting ?? req.ip ?? '';
};
