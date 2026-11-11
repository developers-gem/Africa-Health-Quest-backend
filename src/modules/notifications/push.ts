import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";

export type PushMessage = { title: string; body: string; data: Record<string, string> };
export type PushResult = { sent: number; invalidTokens: string[] };

export interface PushSender {
  readonly name: "fcm" | "none" | "fake";
  send(tokens: string[], message: PushMessage): Promise<PushResult>;
}

/** Push is optional: without Firebase credentials notifications stay in the in-app inbox only. */
export class NoPushSender implements PushSender {
  readonly name = "none" as const;
  async send(): Promise<PushResult> {
    return { sent: 0, invalidTokens: [] };
  }
}

/** Firebase Cloud Messaging (HTTP v1) with a service account from FIREBASE_SERVICE_ACCOUNT_JSON (base64). */
export class FcmPushSender implements PushSender {
  readonly name = "fcm" as const;
  private readonly messaging;

  constructor(serviceAccountJsonBase64: string) {
    const account = JSON.parse(
      Buffer.from(serviceAccountJsonBase64, "base64").toString("utf8"),
    ) as Record<string, string>;
    const app =
      getApps().find((a) => a.name === "ahq") ??
      initializeApp({ credential: cert(account) }, "ahq");
    this.messaging = getMessaging(app);
  }

  async send(tokens: string[], message: PushMessage): Promise<PushResult> {
    if (!tokens.length) return { sent: 0, invalidTokens: [] };
    // Devices are addressed by Firebase Installation ID (FID), as registered by the current FCM SDKs.
    const res = await this.messaging.sendEachForMulticast({
      fids: tokens,
      notification: { title: message.title, body: message.body },
      data: message.data,
      android: { priority: "normal", notification: { channelId: "ahq_default" } },
      apns: { payload: { aps: { sound: "default" } } },
    });
    const invalidTokens = res.responses
      .map((r, i) =>
        r.error &&
        /registration-token-not-registered|invalid-registration-token|invalid-argument/.test(
          r.error.code,
        )
          ? tokens[i]!
          : null,
      )
      .filter((t): t is string => t !== null);
    return { sent: res.successCount, invalidTokens };
  }
}

/** Test double that records what would have been pushed. */
export class FakePushSender implements PushSender {
  readonly name = "fake" as const;
  readonly sent: { tokens: string[]; message: PushMessage }[] = [];
  invalid = new Set<string>();
  async send(tokens: string[], message: PushMessage): Promise<PushResult> {
    this.sent.push({ tokens, message });
    return {
      sent: tokens.filter((t) => !this.invalid.has(t)).length,
      invalidTokens: tokens.filter((t) => this.invalid.has(t)),
    };
  }
}

/** Push sender from configuration: FCM when a service account is configured, otherwise in-app only. */
export function pushSenderFrom(config: {
  FIREBASE_SERVICE_ACCOUNT_JSON?: string | undefined;
}): PushSender {
  return config.FIREBASE_SERVICE_ACCOUNT_JSON
    ? new FcmPushSender(config.FIREBASE_SERVICE_ACCOUNT_JSON)
    : new NoPushSender();
}
