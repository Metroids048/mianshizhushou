import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { makeId, nowIso, safeJsonParse } from "../utils";

export interface MailMessage {
  to: string;
  subject: string;
  template: string;
  variables: Record<string, unknown>;
  userId?: string | null;
}

export interface MailOutboxItem extends MailMessage {
  id: string;
  status: "queued" | "sent" | "failed";
  errorMessage?: string | null;
  createdAt: string;
  sentAt?: string | null;
}

const DEFAULT_OUTBOX_PATH = ".data/mail-outbox.json";
const DEFAULT_OUTBOX_LOG_PATH = ".data/mail-outbox.log";

function getOutboxPath(): string {
  return resolve(process.env.MAIL_OUTBOX_PATH ?? DEFAULT_OUTBOX_PATH);
}

function getOutboxLogPath(): string {
  return resolve(process.env.MAIL_OUTBOX_LOG_PATH ?? DEFAULT_OUTBOX_LOG_PATH);
}

function ensureParent(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

function readOutbox(): MailOutboxItem[] {
  const path = getOutboxPath();
  if (!existsSync(path)) return [];
  const parsed = safeJsonParse<MailOutboxItem[]>(readFileSync(path, "utf8"));
  return Array.isArray(parsed) ? parsed : [];
}

function writeOutbox(items: MailOutboxItem[]): void {
  const path = getOutboxPath();
  ensureParent(path);
  writeFileSync(path, JSON.stringify(items, null, 2), "utf8");
}

function appendLogLine(item: MailOutboxItem): void {
  const path = getOutboxLogPath();
  ensureParent(path);
  appendFileSync(path, `${JSON.stringify(item)}\n`, "utf8");
}

export function createMailService() {
  return {
    async sendEmail(message: MailMessage): Promise<{ ok: true; item: MailOutboxItem }> {
      const now = nowIso();
      const item: MailOutboxItem = {
        id: makeId("mail"),
        to: message.to,
        subject: message.subject,
        template: message.template,
        variables: message.variables,
        userId: message.userId ?? null,
        status: "sent",
        createdAt: now,
        sentAt: now,
      };
      const next = [item, ...readOutbox()];
      writeOutbox(next);
      appendLogLine(item);
      return { ok: true, item };
    },
    listOutbox(): MailOutboxItem[] {
      return readOutbox();
    },
  };
}

export type MailService = ReturnType<typeof createMailService>;
