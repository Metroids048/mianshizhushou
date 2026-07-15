import type { ReactNode } from "react";
import { AlertTriangle, ArrowLeft, Home, LifeBuoy, SearchX } from "lucide-react";
import { navigateTo } from "../../lib/router";
import { Seo } from "./Seo";

function Frame({
  title,
  description,
  icon,
  primaryLabel,
  primaryAction,
  secondaryLabel,
  secondaryAction,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  primaryLabel: string;
  primaryAction: () => void;
  secondaryLabel?: string;
  secondaryAction?: () => void;
}) {
  return (
    <section className="status-page page">
      <div className="status-card">
        <div className="status-icon" aria-hidden="true">
          {icon}
        </div>
        <h1>{title}</h1>
        <p>{description}</p>
        <div className="status-actions">
          <button type="button" className="button primary" onClick={primaryAction}>
            <Home size={16} />
            {primaryLabel}
          </button>
          {secondaryLabel && secondaryAction ? (
            <button type="button" className="button secondary" onClick={secondaryAction}>
              <ArrowLeft size={16} />
              {secondaryLabel}
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export function NotFoundPage() {
  return (
    <>
      <Seo title="页面未找到 | AI 求职台" description="你访问的页面不存在，返回首页继续面试准备。" />
      <Frame
        title="这个页面不存在"
        description="链接可能已经变更，或者你输入了一个无效地址。"
        icon={<SearchX size={26} />}
        primaryLabel="返回首页"
        primaryAction={() => navigateTo("/", { replace: true })}
        secondaryLabel="返回上一页"
        secondaryAction={() => window.history.back()}
      />
    </>
  );
}

export function ServerErrorPage({ inline = false }: { inline?: boolean }) {
  const content = (
    <Frame
      title="页面暂时出了点问题"
      description="我们已经拦截了这次异常。你可以先回到首页，或通过反馈入口联系我们。"
      icon={<AlertTriangle size={26} />}
      primaryLabel="返回首页"
      primaryAction={() => navigateTo("/", { replace: true })}
      secondaryLabel="联系支持"
      secondaryAction={() => navigateTo("/account")}
    />
  );
  if (inline) return content;
  return (
    <>
      <Seo title="服务异常 | AI 求职台" description="页面遇到错误，请返回首页或联系支持。" />
      {content}
    </>
  );
}

export function MinimalSupportHint() {
  return (
    <button type="button" className="button secondary" onClick={() => navigateTo("/account")}>
      <LifeBuoy size={16} />
      联系支持
    </button>
  );
}
