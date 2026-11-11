import { OAuth2Client } from "google-auth-library";

export type GoogleIdentity = {
  sub: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
};

export interface GoogleVerifier {
  /** Returns the verified identity, or null if the token is invalid. */
  verify(idToken: string): Promise<GoogleIdentity | null>;
}

export class GoogleIdTokenVerifier implements GoogleVerifier {
  private readonly client = new OAuth2Client();
  constructor(private readonly audiences: string[]) {}

  async verify(idToken: string): Promise<GoogleIdentity | null> {
    try {
      const ticket = await this.client.verifyIdToken({ idToken, audience: this.audiences });
      const p = ticket.getPayload();
      if (!p?.sub) return null;
      return {
        sub: p.sub,
        email: p.email?.toLowerCase() ?? null,
        emailVerified: p.email_verified === true,
        name: p.name ?? null,
      };
    } catch {
      return null;
    }
  }
}
