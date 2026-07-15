import { ArrowLeft, ArrowRight, Info } from "lucide-react";
import { navigateTo } from "../../lib/router";
import { Seo } from "../system/Seo";

function MvpEmailNoticePage({
  title,
  description,
  seoTitle,
  seoDescription,
}: {
  title: string;
  description: string;
  seoTitle: string;
  seoDescription: string;
}) {
  return (
    <section className="auth-page">
      <Seo title={seoTitle} description={seoDescription} />
      <div className="auth-card">
        <div className="auth-header">
          <span className="auth-logo" aria-hidden="true">
            <Info size={24} />
          </span>
          <h1 className="auth-title">{title}</h1>
          <p className="auth-subtitle">{description}</p>
        </div>
        <div className="auth-form">
          <p className="auth-consent-text">
            请使用注册手机号登录。若忘记密码，登录后打开账户面板，在「账户安全」中直接设置新密码。
          </p>
          <button type="button" className="auth-submit" onClick={() => navigateTo("/auth/login")}>
            去登录
            <ArrowRight size={16} />
          </button>
          <button type="button" className="auth-inline-link" onClick={() => navigateTo("/auth/register")}>
            <ArrowLeft size={14} />
            注册新账号
          </button>
        </div>
      </div>
    </section>
  );
}

export function ForgotPasswordPage() {
  return (
    <MvpEmailNoticePage
      title="内测阶段暂不支持邮件找回"
      description="当前版本未接入真实邮件服务，无法通过邮箱重置密码。"
      seoTitle="忘记密码 | AI 求职台"
      seoDescription="内测阶段请在账户面板直接修改密码。"
    />
  );
}

export function ResetPasswordPage({ token }: { token?: string }) {
  void token;
  return (
    <MvpEmailNoticePage
      title="内测阶段暂不支持邮件重置"
      description="重置链接功能暂未开通。请登录后在账户面板直接设置新密码。"
      seoTitle="重置密码 | AI 求职台"
      seoDescription="内测阶段请在账户面板直接修改密码。"
    />
  );
}

export function VerifyEmailPage({ token }: { token?: string }) {
  void token;
  return (
    <MvpEmailNoticePage
      title="内测阶段暂不支持邮箱验证"
      description="邮件验证功能暂未开通，不影响你使用核心练习功能。"
      seoTitle="验证邮箱 | AI 求职台"
      seoDescription="内测阶段邮箱验证暂未开通。"
    />
  );
}
