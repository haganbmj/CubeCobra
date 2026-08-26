import type { Request } from 'express';
import { ipKeyGenerator } from 'express-rate-limit';

import { clientIp } from './clientIp';

/** Consistent rate-limit key generator: user ID when logged in, IP address otherwise. */
export const userOrIpKey = (req: Request): string =>
  (req as any).user?.id?.toString() ?? ipKeyGenerator(clientIp(req)) ?? 'anon';
