import { type FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuthService } from "./auth.service";
import { applyRateLimit, clientIp, requireAuth } from "../../security";

const RegisterBody = z.object({
  phone: z.string().regex(/^1[3-9]\d{9}$/, "无效的手机号"),
  password: z.string().min(8, "密码至少 8 位").max(64),
  displayName: z.string().max(32).optional(),
});

const LoginBody = z.object({
  phone: z.string().regex(/^1[3-9]\d{9}$/, "无效的手机号"),
  password: z.string().min(8, "密码至少 8 位").max(64),
});

const ForgotPasswordBody = z.object({
  email: z.string().email("无效的邮箱"),
});

const ResetPasswordBody = z.object({
  token: z.string().min(8, "重置链接无效"),
  password: z.string().min(8, "密码至少 8 位").max(64),
});

const SendVerificationBody = z.object({
  email: z.string().email("无效的邮箱").optional(),
  displayName: z.string().max(32).optional(),
});

const VerifyEmailBody = z.object({
  token: z.string().min(8, "验证链接无效"),
});

const DeleteAccountBody = z.object({
  confirmationText: z.literal("DELETE"),
});

const NotificationPrefsBody = z.object({
  marketing: z.boolean().optional(),
  product: z.boolean().optional(),
});

export function registerAuthRoutes(app: FastifyInstance, auth: AuthService) {
  // Register with phone + password
  app.post("/api/auth/register", async (request, reply) => {
    applyRateLimit(`register:${clientIp(request)}`, 8, 10 * 60 * 1000);
    const body = RegisterBody.parse(request.body);
    const { user, tokens } = await auth.register(body);
    return reply.code(201).send({
      user: {
        id: user.id,
        phone: user.phone,
        email: user.email,
        emailVerifiedAt: user.emailVerifiedAt,
        displayName: user.displayName,
        notificationPrefs: user.notificationPrefs,
      },
      tokens,
    });
  });

  // Login with phone + password
  app.post("/api/auth/login", async (request) => {
    applyRateLimit(`login:${clientIp(request)}`, 10, 10 * 60 * 1000);
    const body = LoginBody.parse(request.body);
    const { user, tokens } = await auth.login(body);
    return {
      user: {
        id: user.id,
        phone: user.phone,
        email: user.email,
        emailVerifiedAt: user.emailVerifiedAt,
        displayName: user.displayName,
        notificationPrefs: user.notificationPrefs,
      },
      tokens,
    };
  });

  // Logout
  app.post("/api/auth/logout", async (request) => {
    const header = request.headers.authorization;
    if (header?.startsWith("Bearer ")) {
      await auth.logout(header.slice(7));
    }
    return { ok: true };
  });

  // Get current session
  app.get("/api/auth/session", async (request, reply) => {
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      return reply.code(401).send({ error: { code: "UNAUTHORIZED", message: "未登录" } });
    }
    const session = auth.validateSession(header.slice(7));
    return session;
  });

  app.post("/api/auth/password/forgot", async (request) => {
    applyRateLimit(`forgot:${clientIp(request)}`, 5, 15 * 60 * 1000);
    const body = ForgotPasswordBody.parse(request.body);
    return auth.createPasswordReset(body.email);
  });

  app.post("/api/auth/password/reset", async (request) => {
    applyRateLimit(`reset:${clientIp(request)}`, 10, 15 * 60 * 1000);
    const body = ResetPasswordBody.parse(request.body);
    const user = await auth.resetPassword(body.token, body.password);
    return {
      ok: true,
      user: {
        id: user.id,
        phone: user.phone,
        email: user.email,
        emailVerifiedAt: user.emailVerifiedAt,
        displayName: user.displayName,
        notificationPrefs: user.notificationPrefs,
      },
    };
  });

  app.post("/api/auth/email/send-verification", async (request) => {
    const session = requireAuth(request);
    applyRateLimit(`verify-email:${session.userId}`, 5, 15 * 60 * 1000);
    const body = SendVerificationBody.parse(request.body ?? {});
    if (body.email || body.displayName) {
      await auth.updateAccount(session.userId, {
        email: body.email,
        displayName: body.displayName,
      });
    }
    const result = await auth.sendVerificationEmail(session.userId);
    return { ok: true, email: result.email };
  });

  app.post("/api/auth/email/verify", async (request) => {
    const body = VerifyEmailBody.parse(request.body);
    const user = await auth.verifyEmail(body.token);
    return {
      ok: true,
      user: {
        id: user.id,
        phone: user.phone,
        email: user.email,
        emailVerifiedAt: user.emailVerifiedAt,
        displayName: user.displayName,
        notificationPrefs: user.notificationPrefs,
      },
    };
  });

  app.post("/api/account/notification-preferences", async (request) => {
    const session = requireAuth(request);
    const body = NotificationPrefsBody.parse(request.body);
    const user = await auth.updateAccount(session.userId, {
      notificationPrefs: body,
    });
    return {
      ok: true,
      notificationPrefs: user.notificationPrefs,
    };
  });

  app.post("/api/account/profile", async (request) => {
    const session = requireAuth(request);
    const body = z.object({
      displayName: z.string().max(32).optional(),
      email: z.string().email("无效的邮箱").optional(),
      password: z.string().min(8, "密码至少 8 位").max(64).optional(),
    }).parse(request.body ?? {});
    const user = await auth.updateAccount(session.userId, body);
    return {
      ok: true,
      user: {
        id: user.id,
        phone: user.phone,
        email: user.email,
        emailVerifiedAt: user.emailVerifiedAt,
        displayName: user.displayName,
        notificationPrefs: user.notificationPrefs,
      },
    };
  });

  app.delete("/api/user", async (request) => {
    const session = requireAuth(request);
    const body = DeleteAccountBody.parse(request.body ?? {});
    await auth.deleteAccount(session.userId);
    return { ok: true, confirmationText: body.confirmationText };
  });
}
