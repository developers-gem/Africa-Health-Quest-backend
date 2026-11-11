import { pino, type Logger } from "pino";

export type { Logger };

export function createLogger(level: string, pretty = false): Logger {
  return pino({
    level,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        'res.headers["set-cookie"]',
        "*.password",
        "*.refreshToken",
        "*.token",
        "*.idToken",
      ],
      censor: "[redacted]",
    },
    ...(pretty ? {} : { base: { service: "ahq-api" } }),
  });
}
