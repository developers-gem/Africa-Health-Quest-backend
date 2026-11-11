import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import nodemailer from "nodemailer";
import type { Logger } from "../lib/logger.js";

export type MailMessage = { to: string; subject: string; text: string };

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** Development/test transport: logs mail (without bodies, which hold tokens) and keeps it in memory. */
export class LogMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  constructor(private readonly logger: Logger) {}
  async send(message: MailMessage) {
    this.sent.push(message);
    this.logger.info({ to: message.to, subject: message.subject }, "mail (log transport)");
  }
}

/** Development/E2E transport: writes each message (including its links) to a local directory. Refused in production. */
export class FileMailer implements Mailer {
  private seq = 0;
  constructor(private readonly dir: string) {}
  async send(message: MailMessage) {
    await mkdir(this.dir, { recursive: true });
    const name = `${Date.now()}-${String(++this.seq).padStart(4, "0")}.json`;
    await writeFile(
      join(this.dir, name),
      JSON.stringify({ ...message, sentAt: new Date().toISOString() }),
    );
  }
}

export class SmtpMailer implements Mailer {
  private readonly transport;
  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    this.transport = nodemailer.createTransport(smtpUrl);
  }
  async send(message: MailMessage) {
    await this.transport.sendMail({ from: this.from, ...message });
  }
}
