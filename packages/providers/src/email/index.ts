/** Transactional email (FAV-201/205). Mock logs in dev; Resend adapter in prod. */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

/**
 * Dev provider: logs the message (including the link) so verification and
 * reset flows are exercisable without an email account. Never use in prod —
 * getEmailProvider only selects it when no API key is configured.
 */
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = "console";
  /** Test hook: everything "sent" during this process. */
  readonly outbox: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.outbox.push(message);
    console.log(
      JSON.stringify({ event: "email_sent", provider: this.name, to: message.to, subject: message.subject })
    );
    console.log(`--- email to ${message.to}: ${message.subject}\n${message.text}\n---`);
  }
}

export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";

  constructor(
    private readonly apiKey: string,
    private readonly from: string
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        text: message.text
      })
    });
    if (!res.ok) throw new Error(`Resend HTTP ${res.status}: ${await res.text()}`);
  }
}

let emailSingleton: EmailProvider | null = null;

export function getEmailProvider(): EmailProvider {
  if (emailSingleton) return emailSingleton;
  const { RESEND_API_KEY, EMAIL_FROM } = process.env;
  emailSingleton =
    RESEND_API_KEY && EMAIL_FROM
      ? new ResendEmailProvider(RESEND_API_KEY, EMAIL_FROM)
      : new ConsoleEmailProvider();
  return emailSingleton;
}

/** Test hook. */
export function resetEmailProvider(): void {
  emailSingleton = null;
}
