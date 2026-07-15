import {
  BookOpen,
  ChevronDown,
  BriefcaseBusiness,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileSearch,
  FileText,
  MessageSquarePlus,
  Headphones,
  Radio,
  Menu,
  Mic,
  ScrollText,
  UserRound,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { loadUiPrefs, saveUiPrefs } from "../lib/store";
import { navigateTo } from "../lib/router";

const FOOTER_LINKS: Array<{ path: string; label: string }> = [
  { path: "/about", label: "关于我们" },
  { path: "/help", label: "帮助中心" },
  { path: "/terms-of-service", label: "用户协议" },
  { path: "/privacy-policy", label: "隐私政策" },
];

export type PrimaryRouteName = "home" | "live" | "audioBridge" | "mock" | "jd" | "questions" | "resume" | "records" | "authLogin" | "authRegister" | "onboarding" | "account";

type NavItem = {
  id: PrimaryRouteName;
  label: string;
  icon: typeof Headphones;
};

const PRIMARY_NAV: NavItem[] = [
  { id: "home", label: "首页", icon: BriefcaseBusiness },
  { id: "live", label: "实时助手", icon: Headphones },
  { id: "audioBridge", label: "会议监听", icon: Radio },
  { id: "mock", label: "模拟面试", icon: Mic },
  { id: "jd", label: "JD分析", icon: FileSearch },
  { id: "questions", label: "问题记录", icon: ScrollText },
  { id: "resume", label: "我的简历", icon: FileText },
  { id: "records", label: "面试记录", icon: ClipboardList },
];

const MAIN_NAV = PRIMARY_NAV.slice(0, 4);
const LIBRARY_NAV = PRIMARY_NAV.slice(4);

const MOBILE_NAV_BREAKPOINT = 760;

function useMobileNav() {
  const [isMobile, setIsMobile] = useState(() => (typeof window === "undefined" ? false : window.innerWidth <= MOBILE_NAV_BREAKPOINT));

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= MOBILE_NAV_BREAKPOINT);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return isMobile;
}

export function AppShell({
  activeNav,
  accountName,
  isLoggedIn,
  onNavigate,
  onAccount,
  onFeedback,
  children,
}: {
  activeNav: PrimaryRouteName;
  accountName: string;
  isLoggedIn: boolean;
  onNavigate: (route: PrimaryRouteName) => void;
  onAccount: () => void;
  onFeedback: () => void;
  children: ReactNode;
}) {
  const isMobile = useMobileNav();
  const [desktopPrefs, setDesktopPrefs] = useState(() => loadUiPrefs());
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [libraryManualOpen, setLibraryManualOpen] = useState(() => LIBRARY_NAV.some((item) => item.id === activeNav));
  const libraryRouteActive = LIBRARY_NAV.some((item) => item.id === activeNav);
  const libraryOpen = libraryRouteActive || libraryManualOpen;
  const expanded = isMobile ? true : desktopPrefs.desktopSidebarExpanded;

  useEffect(() => {
    if (isMobile) return;
    saveUiPrefs(desktopPrefs);
  }, [desktopPrefs, isMobile]);

  const closeMobileDrawer = () => setMobileDrawerOpen(false);

  const sidebar = (
    <>
      <div className="shell-brand">
        <button className="shell-brand-button" type="button" onClick={() => onNavigate("home")} aria-label="返回岗位台">
          <span className="shell-brand-mark" aria-hidden="true">
            <BriefcaseBusiness size={18} />
          </span>
          {(expanded || isMobile) && (
            <span className="shell-brand-copy">
              <strong>AI 求职台</strong>
              <small>面试准备主线</small>
            </span>
          )}
        </button>
        {!isMobile && isLoggedIn ? (
          <button
            className="shell-collapse-button"
            type="button"
            onClick={() =>
              setDesktopPrefs((current) => ({
                desktopSidebarExpanded: !current.desktopSidebarExpanded,
                desktopSidebarTouched: true,
              }))
            }
            aria-label={expanded ? "收起侧边栏" : "展开侧边栏"}
          >
            {expanded ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
          </button>
        ) : null}
      </div>

      <>
        <nav className="shell-nav" aria-label="主导航">
          <span className="shell-nav-group-label">{expanded || isMobile ? "主线功能" : ""}</span>
          {MAIN_NAV.map((item) => {
            const Icon = item.icon;
            const active = item.id === activeNav;
            return (
              <button
                key={item.id}
                type="button"
                className={active ? "shell-nav-item active" : "shell-nav-item"}
                aria-current={active ? "page" : undefined}
                aria-label={item.label}
                title={item.label}
                onClick={() => {
                  onNavigate(item.id);
                  closeMobileDrawer();
                }}
              >
                <span className="shell-nav-icon">
                  <Icon size={18} />
                </span>
                {expanded || isMobile ? <span className="shell-nav-label">{item.label}</span> : null}
              </button>
            );
          })}

          <details
            className={`shell-nav-library${libraryOpen ? " open" : ""}`}
            open={libraryOpen}
            onToggle={(event) => setLibraryManualOpen((event.currentTarget as HTMLDetailsElement).open)}
          >
            <summary className="shell-nav-library-summary" aria-expanded={libraryOpen}>
              <span className="shell-nav-icon">
                <BookOpen size={18} />
              </span>
              {expanded || isMobile ? (
                <>
                  <span className="shell-nav-label">资料库</span>
                  <span className="shell-nav-library-caret" aria-hidden="true">
                    <ChevronDown size={14} />
                  </span>
                </>
              ) : null}
            </summary>
            <div className="shell-nav-library-list">
              {LIBRARY_NAV.map((item) => {
                const Icon = item.icon;
                const active = item.id === activeNav;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={active ? "shell-nav-item active" : "shell-nav-item"}
                    aria-current={active ? "page" : undefined}
                    aria-label={item.label}
                    title={item.label}
                    onClick={() => {
                      onNavigate(item.id);
                      closeMobileDrawer();
                    }}
                  >
                    <span className="shell-nav-icon">
                      <Icon size={18} />
                    </span>
                    {expanded || isMobile ? <span className="shell-nav-label">{item.label}</span> : null}
                  </button>
                );
              })}
            </div>
          </details>
        </nav>

        {isLoggedIn ? (
          <button className="shell-account" type="button" onClick={onAccount} aria-label={`${accountName || "候选人"}，打开账户与数据`}>
            <span className="shell-nav-icon">
              <UserRound size={18} />
            </span>
            {(expanded || isMobile) && (
              <span className="shell-account-copy">
                <strong>{accountName || "候选人"}</strong>
                <small>账户与数据</small>
              </span>
            )}
          </button>
        ) : (
          <button
            className="shell-account"
            type="button"
            onClick={() => {
              onNavigate("authLogin");
              closeMobileDrawer();
            }}
            aria-label="登录后自动保存与同步"
          >
            <span className="shell-nav-icon">
              <UserRound size={18} />
            </span>
            {(expanded || isMobile) && (
              <span className="shell-account-copy">
                <strong>登录 / 注册</strong>
                <small>登录后自动保存与同步</small>
              </span>
            )}
          </button>
        )}
      </>
    </>
  );

  return (
    <div className={`app-shell app-shell-v3${expanded ? " expanded" : ""}${isMobile ? " mobile" : ""}`}>
      <a className="skip-link" href="#main-content">
        跳到内容
      </a>

      {isMobile ? (
        <>
          <header className="mobile-topbar">
            <button className="mobile-topbar-button" type="button" onClick={() => setMobileDrawerOpen(true)} aria-label="打开导航菜单">
              <Menu size={18} />
            </button>
            <div className="mobile-topbar-copy">
              <strong>AI 求职台</strong>
              <small>{isLoggedIn ? (PRIMARY_NAV.find((item) => item.id === activeNav)?.label ?? "岗位台") : "面试准备"}</small>
            </div>
            {isLoggedIn ? (
              <button className="mobile-topbar-button" type="button" onClick={onAccount} aria-label="打开账户与数据">
                <UserRound size={18} />
              </button>
            ) : (
              <button className="mobile-topbar-button" type="button" onClick={() => { onNavigate("authLogin"); closeMobileDrawer(); }} aria-label="登录">
                <UserRound size={18} />
              </button>
            )}
          </header>

          {mobileDrawerOpen ? (
            <div className="mobile-drawer-backdrop" role="presentation" onClick={closeMobileDrawer}>
              <aside className="mobile-drawer" role="dialog" aria-modal="true" aria-label="主导航抽屉" onClick={(event) => event.stopPropagation()}>
                {sidebar}
              </aside>
            </div>
          ) : null}
        </>
      ) : (
        <aside className={`shell-sidebar${expanded ? " expanded" : " collapsed"}`}>{sidebar}</aside>
      )}

      {/* 桌面端侧边栏悬浮展开时的遮罩层 */}
      {!isMobile && expanded && (
        <div
          className="sidebar-overlay-v3"
          role="presentation"
          onClick={() =>
            setDesktopPrefs(() => ({
              desktopSidebarExpanded: false,
              desktopSidebarTouched: true,
            }))
          }
        />
      )}

      <main className="main main-v3" id="main-content">
        {children}
        <footer className="shell-footer" aria-label="页脚信息">
          <nav className="shell-footer-links" aria-label="法务与帮助">
            {FOOTER_LINKS.map((link) => (
              <button
                key={link.path}
                type="button"
                className="shell-footer-link"
                onClick={() => {
                  navigateTo(link.path);
                  closeMobileDrawer();
                }}
              >
                {link.label}
              </button>
            ))}
          </nav>
          <span className="shell-footer-copy">© 2025 AI 求职台 · 仅供面试练习参考</span>
        </footer>
      </main>
      <button type="button" className="feedback-fab" onClick={onFeedback} aria-label="打开反馈入口">
        <MessageSquarePlus size={18} />
        <span>反馈</span>
      </button>
    </div>
  );
}
