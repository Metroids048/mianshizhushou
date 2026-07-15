import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import jwt from "jsonwebtoken";
import type { AppDb } from "../../db";
import type { AuthTokens, JwtPayload, LoginInput, NotificationPrefs, RegisterInput, SessionInfo, User } from "./types";
import { makeId, nowIso } from "../../utils";
import { createOneTimeToken, hashOpaqueToken } from "../../security";
import { MAIL_TEMPLATES } from "../../mail/templates";
import type { MailService } from "../../mail/service";

const DEFAULT_JWT_SECRET = "ai-job-dev-secret-change-in-production";
const JWT_EXPIRES_IN = "30d";
const SALT_LENGTH = 32;
const KEY_LENGTH = 64;
const EMAIL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

function getConfiguredJwtSecret(): string | null {
  return process.env.JWT_SECRET?.trim() || null;
}

function resolveJwtSecret(): string {
  const configured = getConfiguredJwtSecret();
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET must be configured in production.");
  }
  return DEFAULT_JWT_SECRET;
}

function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LENGTH).toString("hex");
  const hash = scryptSync(password, salt, KEY_LENGTH).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const computed = scryptSync(password, salt, KEY_LENGTH);
  const expected = Buffer.from(hash, "hex");
  if (computed.length !== expected.length) return false;
  return timingSafeEqual(computed, expected);
}

function signToken(userId: string, jti: string, jwtSecret = resolveJwtSecret()): string {
  const payload: Omit<JwtPayload, "iat" | "exp"> = { sub: userId, jti };
  return jwt.sign(payload, jwtSecret, { expiresIn: JWT_EXPIRES_IN, issuer: "ai-job-platform" });
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  marketing: true,
  product: true,
  security: true,
};

function normalizeNotificationPrefs(raw: string | null | undefined): NotificationPrefs {
  try {
    const parsed = raw ? (JSON.parse(raw) as Partial<NotificationPrefs>) : {};
    return {
      marketing: parsed.marketing ?? DEFAULT_NOTIFICATION_PREFS.marketing,
      product: parsed.product ?? DEFAULT_NOTIFICATION_PREFS.product,
      security: true,
    };
  } catch {
    return { ...DEFAULT_NOTIFICATION_PREFS };
  }
}

function serializeNotificationPrefs(prefs: NotificationPrefs): string {
  return JSON.stringify({
    marketing: Boolean(prefs.marketing),
    product: Boolean(prefs.product),
    security: true,
  });
}

function verifyToken(token: string, jwtSecret = resolveJwtSecret()): JwtPayload {
  return jwt.verify(token, jwtSecret, { issuer: "ai-job-platform" }) as JwtPayload;
}

export function createAuthService(db: AppDb, mailer: MailService) {
  const jwtSecret = resolveJwtSecret();
  if (jwtSecret === DEFAULT_JWT_SECRET) {
    console.warn("[auth] JWT_SECRET 未配置，当前使用默认开发密钥。正式部署前请设置独立密钥。");
  }

  function toUser(row: {
    id: string;
    phone: string | null;
    email: string | null;
    displayName: string;
    passwordHash: string | null;
    emailVerifiedAt: string | null;
    deletedAt: string | null;
    notificationPrefs: string;
    createdAt: string;
    updatedAt: string;
  }): User {
    return {
      id: row.id,
      phone: row.phone,
      email: row.email,
      displayName: row.displayName,
      passwordHash: row.passwordHash,
      emailVerifiedAt: row.emailVerifiedAt,
      deletedAt: row.deletedAt,
      notificationPrefs: normalizeNotificationPrefs(row.notificationPrefs),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  function internalGetUserByPhone(phone: string): User | undefined {
    const row = db.getUserByPhone(phone);
    return row && !row.deletedAt ? toUser(row) : undefined;
  }

  function internalGetUserByEmail(email: string): User | undefined {
    const row = db.getUserByEmail(email);
    return row && !row.deletedAt ? toUser(row) : undefined;
  }

  function internalGetUserById(userId: string): User | undefined {
    const row = db.getUserById(userId);
    return row && !row.deletedAt ? toUser(row) : undefined;
  }

  function internalSaveUser(user: User): User {
    const existing = db.getUserById(user.id);
    const row = {
      id: user.id,
      phone: user.phone,
      email: user.email,
      displayName: user.displayName,
      passwordHash: user.passwordHash,
      emailVerifiedAt: user.emailVerifiedAt,
      emailVerificationTokenHash: existing?.emailVerificationTokenHash ?? null,
      emailVerificationExpiresAt: existing?.emailVerificationExpiresAt ?? null,
      passwordResetTokenHash: existing?.passwordResetTokenHash ?? null,
      passwordResetExpiresAt: existing?.passwordResetExpiresAt ?? null,
      deletedAt: user.deletedAt,
      notificationPrefs: serializeNotificationPrefs(user.notificationPrefs),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
    if (existing) {
      db.updateUser(row);
    } else {
      db.insertUser(row);
    }
    return toUser(row);
  }

  function internalCreateUser(phone: string, displayName?: string, password?: string, email?: string): User {
    const now = nowIso();
    const passwordHash = password ? hashPassword(password) : null;
    const user: User = {
      id: makeId("user"),
      phone,
      email: email?.trim().toLowerCase() || null,
      displayName: displayName?.trim() || "",
      passwordHash,
      emailVerifiedAt: null,
      deletedAt: null,
      notificationPrefs: { ...DEFAULT_NOTIFICATION_PREFS },
      createdAt: now,
      updatedAt: now,
    };
    return internalSaveUser(user);
  }

  function internalCreateSession(userId: string): AuthTokens {
    const jti = makeId("jti");
    const now = nowIso();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    db.insertSession({
      id: makeId("sess"),
      userId,
      tokenJti: jti,
      expiresAt,
      createdAt: now,
    });
    const accessToken = signToken(userId, jti, jwtSecret);
    return { accessToken, expiresAt };
  }

  function getBaseUrl(): string {
    return process.env.APP_BASE_URL ?? "http://127.0.0.1:5173";
  }

  function toSessionInfo(user: User): SessionInfo {
    return {
      userId: user.id,
      phone: user.phone,
      email: user.email,
      emailVerifiedAt: user.emailVerifiedAt,
      displayName: user.displayName,
      notificationPrefs: user.notificationPrefs,
    };
  }

  function requireStoredUser(userId: string) {
    const row = db.getUserById(userId);
    if (!row || row.deletedAt) {
      throw Object.assign(new Error("USER_NOT_FOUND"), { statusCode: 404 });
    }
    return row;
  }

  async function sendVerificationEmail(userId: string): Promise<{ email: string }> {
    const row = requireStoredUser(userId);
    const user = toUser(row);
    if (!user.email) {
      throw Object.assign(new Error("EMAIL_REQUIRED"), { statusCode: 400 });
    }
    const { plainToken, tokenHash } = createOneTimeToken();
    const expiresAt = new Date(Date.now() + EMAIL_TOKEN_TTL_MS).toISOString();
    db.updateUser({
      ...row,
      emailVerificationTokenHash: tokenHash,
      emailVerificationExpiresAt: expiresAt,
      updatedAt: nowIso(),
    });
    const verifyUrl = `${getBaseUrl()}/verify-email?token=${encodeURIComponent(plainToken)}`;
    await mailer.sendEmail({
      to: user.email,
      subject: MAIL_TEMPLATES.verifyEmail.subject,
      template: "verifyEmail",
      userId: user.id,
      variables: {
        displayName: user.displayName || "候选人",
        verifyUrl,
        expiresAt,
      },
    });
    return { email: user.email };
  }

  return {
    hashPassword,

    async register(input: RegisterInput): Promise<{ user: User; tokens: AuthTokens }> {
      const existing = internalGetUserByPhone(input.phone);
      if (existing) {
        throw Object.assign(new Error("PHONE_ALREADY_REGISTERED"), { statusCode: 409 });
      }

      const user = internalCreateUser(input.phone, input.displayName, input.password);
      db.insertAuthIdentity({
        id: makeId("authid"),
        userId: user.id,
        provider: "phone",
        identifier: input.phone,
        createdAt: nowIso(),
      });
      if (db.db) {
        db.db.prepare("insert into audit_events(id, user_id, action, detail, created_at) values (?, ?, ?, ?, ?)")
          .run(makeId("audit"), user.id, "register", JSON.stringify({ phone: user.phone }), nowIso());
      }

      const tokens = internalCreateSession(user.id);
      return { user, tokens };
    },

    async login(input: LoginInput): Promise<{ user: User; tokens: AuthTokens }> {
      const user = internalGetUserByPhone(input.phone);
      if (!user) {
        throw Object.assign(new Error("INVALID_CREDENTIALS"), { statusCode: 401 });
      }

      if (!user.passwordHash || !verifyPassword(input.password, user.passwordHash)) {
        throw Object.assign(new Error("INVALID_CREDENTIALS"), { statusCode: 401 });
      }

      const tokens = internalCreateSession(user.id);
      if (db.db) {
        db.db.prepare("insert into audit_events(id, user_id, action, detail, created_at) values (?, ?, ?, ?, ?)")
          .run(makeId("audit"), user.id, "login", JSON.stringify({ phone: user.phone }), nowIso());
      }
      return { user, tokens };
    },

    async logout(token: string): Promise<void> {
      try {
        const payload = verifyToken(token, jwtSecret);
        db.deleteSessionByJti(payload.jti);
      } catch {
        // Token already invalid, nothing to do
      }
    },

    validateSession(token: string): SessionInfo {
      let payload: JwtPayload;
      try {
        payload = verifyToken(token, jwtSecret);
      } catch {
        throw Object.assign(new Error("INVALID_TOKEN"), { statusCode: 401 });
      }
      const session = db.getSessionByJti(payload.jti, nowIso());
      if (!session) {
        throw Object.assign(new Error("SESSION_EXPIRED"), { statusCode: 401 });
      }
      const user = internalGetUserById(payload.sub);
      if (!user) {
        throw Object.assign(new Error("USER_NOT_FOUND"), { statusCode: 401 });
      }
      return toSessionInfo(user);
    },

    async updateAccount(userId: string, input: {
      displayName?: string;
      email?: string | null;
      password?: string | null;
      notificationPrefs?: Partial<NotificationPrefs>;
    }): Promise<User> {
      const row = requireStoredUser(userId);
      const nextEmail = input.email === undefined ? row.email : input.email?.trim().toLowerCase() || null;
      if (nextEmail && nextEmail !== row.email) {
        const existing = db.getUserByEmail(nextEmail);
        if (existing && existing.id !== userId && !existing.deletedAt) {
          throw Object.assign(new Error("EMAIL_ALREADY_REGISTERED"), { statusCode: 409 });
        }
      }
      const nextPrefs = {
        ...normalizeNotificationPrefs(row.notificationPrefs),
        ...input.notificationPrefs,
        security: true,
      };
      const emailChanged = nextEmail !== row.email;
      const updatedRow = {
        ...row,
        email: nextEmail,
        displayName: input.displayName?.trim() ?? row.displayName,
        passwordHash: input.password ? hashPassword(input.password) : row.passwordHash,
        emailVerifiedAt: emailChanged ? null : row.emailVerifiedAt,
        emailVerificationTokenHash: emailChanged ? null : row.emailVerificationTokenHash,
        emailVerificationExpiresAt: emailChanged ? null : row.emailVerificationExpiresAt,
        notificationPrefs: serializeNotificationPrefs(nextPrefs),
        updatedAt: nowIso(),
      };
      db.updateUser(updatedRow);
      const user = toUser(updatedRow);
      if (emailChanged && user.email) {
        await sendVerificationEmail(userId);
      }
      return user;
    },

    async sendVerificationEmail(userId: string): Promise<{ email: string }> {
      return sendVerificationEmail(userId);
    },

    async verifyEmail(token: string): Promise<User> {
      const tokenHash = hashOpaqueToken(token);
      const row = db.getUserByEmailVerificationToken(tokenHash, nowIso());
      if (!row || row.deletedAt) {
        throw Object.assign(new Error("EMAIL_VERIFICATION_TOKEN_INVALID"), { statusCode: 400 });
      }
      const updatedRow = {
        ...row,
        emailVerifiedAt: nowIso(),
        emailVerificationTokenHash: null,
        emailVerificationExpiresAt: null,
        updatedAt: nowIso(),
      };
      db.updateUser(updatedRow);
      if (db.db) {
        db.db.prepare("insert into audit_events(id, user_id, action, detail, created_at) values (?, ?, ?, ?, ?)")
          .run(makeId("audit"), row.id, "email_verified", row.email ?? "", nowIso());
      }
      return toUser(updatedRow);
    },

    async createPasswordReset(email: string): Promise<{ ok: true }> {
      const user = internalGetUserByEmail(email.trim().toLowerCase());
      if (!user || !user.email) {
        return { ok: true };
      }
      if (!user.emailVerifiedAt) {
        throw Object.assign(new Error("EMAIL_VERIFICATION_REQUIRED"), { statusCode: 403 });
      }
      const row = requireStoredUser(user.id);
      const { plainToken, tokenHash } = createOneTimeToken();
      const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS).toISOString();
      db.updateUser({
        ...row,
        passwordResetTokenHash: tokenHash,
        passwordResetExpiresAt: expiresAt,
        updatedAt: nowIso(),
      });
      const resetUrl = `${getBaseUrl()}/reset-password?token=${encodeURIComponent(plainToken)}`;
      await mailer.sendEmail({
        to: user.email,
        subject: MAIL_TEMPLATES.resetPassword.subject,
        template: "resetPassword",
        userId: user.id,
        variables: {
          displayName: user.displayName || "候选人",
          resetUrl,
          expiresAt,
        },
      });
      return { ok: true };
    },

    async resetPassword(token: string, nextPassword: string): Promise<User> {
      const tokenHash = hashOpaqueToken(token);
      const row = db.getUserByPasswordResetToken(tokenHash, nowIso());
      if (!row || row.deletedAt) {
        throw Object.assign(new Error("PASSWORD_RESET_TOKEN_INVALID"), { statusCode: 400 });
      }
      const updatedRow = {
        ...row,
        passwordHash: hashPassword(nextPassword),
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
        updatedAt: nowIso(),
      };
      db.updateUser(updatedRow);
      db.deleteSessionsByUserId(row.id);
      if (db.db) {
        db.db.prepare("insert into audit_events(id, user_id, action, detail, created_at) values (?, ?, ?, ?, ?)")
          .run(makeId("audit"), row.id, "password_reset", row.email ?? "", nowIso());
      }
      return toUser(updatedRow);
    },

    async deleteAccount(userId: string): Promise<void> {
      const row = requireStoredUser(userId);
      const deletedAt = nowIso();
      db.saveState({ profile: { ...db.getState(userId).profile, resumeText: "", evidenceLibrary: [], highlights: [] }, positions: [], records: [], journeyState: "guest" }, userId);
      db.updateUser({
        ...row,
        phone: null,
        email: row.email,
        displayName: row.displayName,
        passwordHash: null,
        emailVerificationTokenHash: null,
        emailVerificationExpiresAt: null,
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
        deletedAt,
        updatedAt: deletedAt,
      });
      db.deleteSessionsByUserId(userId);
      if (row.email) {
        await mailer.sendEmail({
          to: row.email,
          subject: MAIL_TEMPLATES.accountDeletion.subject,
          template: "accountDeletion",
          userId,
          variables: {
            displayName: row.displayName || "候选人",
            deletedAt,
          },
        });
      }
      if (db.db) {
        db.db.prepare("insert into audit_events(id, user_id, action, detail, created_at) values (?, ?, ?, ?, ?)")
          .run(makeId("audit"), userId, "account_deleted", JSON.stringify({ deletedAt }), nowIso());
      }
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
