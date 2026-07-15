import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";
import { chromium, expect, type BrowserContext, type Page } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const node = process.execPath;
const backendPort = Number(process.env.ADV_BACKEND_PORT ?? 8898);
const frontendPort = Number(process.env.ADV_FRONTEND_PORT ?? 5274);
const backendUrl = `http://127.0.0.1:${backendPort}`;
const frontendUrl = `http://127.0.0.1:${frontendPort}`;
const artifactsDir = resolve(root, "web", "artifacts", "adversarial-acceptance");
const children: ChildProcess[] = [];

function start(command: string, args: string[], env: NodeJS.ProcessEnv) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  children.push(child);
  child.stdout?.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr?.on("data", (chunk) => process.stderr.write(chunk));
  return child;
}

async function stop(child: ChildProcess | undefined) {
  if (!child || child.exitCode !== null || child.killed) return;
  await new Promise<void>((resolveStop) => {
    const timer = setTimeout(resolveStop, 2_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolveStop();
    });
    child.kill();
  });
}

async function waitFor(url: string, name: string) {
  const deadline = Date.now() + 60_000;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = `${response.status}`;
    } catch (error) {
      lastError = String(error);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  throw new Error(`${name} not ready: ${lastError}`);
}

async function requireRemoteModel() {
  const response = await fetch(`${backendUrl}/api/health`);
  const health = (await response.json()) as { model?: string };
  if (!health.model || health.model === "local-fallback") {
    throw new Error(`remote model unavailable after startup: ${JSON.stringify(health)}`);
  }
  return health.model;
}

async function launchPersistent(profileDir: string): Promise<BrowserContext> {
  for (const channel of ["msedge", "chrome"] as const) {
    try {
      return await chromium.launchPersistentContext(profileDir, { channel, headless: true, locale: "zh-CN" });
    } catch {
      // Try the next installed desktop browser before Playwright Chromium.
    }
  }
  return chromium.launchPersistentContext(profileDir, { headless: true, locale: "zh-CN" });
}

function assertNoOverflow(page: Page, label: string) {
  return page.evaluate(() => ({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth }))
    .then((sizes) => {
      if (sizes.documentWidth > sizes.viewport + 2 || sizes.bodyWidth > sizes.viewport + 2) {
        throw new Error(`${label} horizontal overflow: ${JSON.stringify(sizes)}`);
      }
    });
}

async function registerAndSave(page: Page) {
  const phone = `138${String(Date.now()).slice(-8)}`;
  await page.goto(frontendUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "注册" }).click();
  await page.getByPlaceholder("手机号").fill(phone);
  await page.getByPlaceholder("至少 8 位密码").fill("Adversarial123");
  await page.getByPlaceholder("昵称，可选").fill("对抗验收用户");
  await page.getByRole("button", { name: "注册并进入工具" }).click();
  await expect(page.getByText("对抗验收用户")).toBeVisible();

  await page.getByRole("button", { name: /资料库/ }).first().click();
  await page.getByPlaceholder("粘贴你的简历正文，保存后会自动抽取证据。").fill("陈晨，AI 产品经理。主导面试提词产品的 RAG 资料库和质量评估，提词卡采纳率提升 18%。");
  await page.getByRole("button", { name: /保存简历/ }).click();
  await expect(page.getByText("简历已保存，并重新沉淀为可引用证据。")).toBeVisible({ timeout: 15_000 });

  await page.getByPlaceholder("粘贴项目背景、你的职责、动作、指标、结果和复盘。").fill("面试提词项目：我负责用户访谈、检索召回、提词卡生成和上线评估，首轮转化提升 18%。");
  await page.getByRole("button", { name: /保存项目资料/ }).click();
  await expect(page.getByRole("button", { name: /保存中/ })).toBeDisabled();
  await expect(page.getByText("项目资料已保存，并重新进入 RAG 资料库。")).toBeVisible({ timeout: 15_000 });

  await page.getByPlaceholder("粘贴目标岗位 JD 或面试背景。").fill("AI 产品经理，要求熟悉 RAG、用户研究和数据分析。");
  await page.getByRole("button", { name: /保存目标 JD/ }).click();
  await expect(page.getByRole("button", { name: /保存中/ })).toBeDisabled();
  await expect(page.getByText("目标 JD 已保存，并进入资料库检索范围。")).toBeVisible({ timeout: 15_000 });
}

async function requireRemoteCueCard(page: Page) {
  await page.getByRole("button", { name: /监听提词台/ }).click();
  await page.getByPlaceholder("例如：请介绍一个你做过的项目，以及你具体负责什么？").fill("请介绍一个你主导的 AI 面试提词项目。", { timeout: 10_000 });
  const started = Date.now();
  await page.getByRole("button", { name: /生成提词卡/ }).click();
  await expect(page.getByRole("button", { name: "生成中..." })).toBeVisible();
  await expect(page.getByRole("button", { name: "生成提词卡" })).toBeEnabled({ timeout: 12_000 });
  await expect(page.getByText("推荐开场")).toBeVisible();
  await expect(page.locator(".yp-status").filter({ hasText: "模型生成" })).toBeVisible();
  const elapsed = Date.now() - started;
  if (elapsed > 8_000) throw new Error(`cue-card exceeded 8s: ${elapsed}ms`);
  await expect(page.getByText(/面试提词项目|资料库/).first()).toBeVisible();
}

async function verifyAnonymousAndDeniedMic(context: BrowserContext) {
  const page = await context.newPage();
  await page.goto(frontendUrl, { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("例如：请介绍一个你做过的项目，以及你具体负责什么？").fill("未登录用户的问题");
  await page.getByRole("button", { name: /生成提词卡/ }).click();
  await expect(page.getByText("请先登录后再生成提词卡。")).toBeVisible();
  await page.getByRole("button", { name: "麦克风" }).click();
  await page.getByRole("button", { name: /开始麦克风监听/ }).click();
  await expect(page.getByText(/权限|不支持语音识别|麦克风监听失败/).first()).toBeVisible();
  await page.close();
}

async function main() {
  mkdirSync(artifactsDir, { recursive: true });
  const tempDir = mkdtempSync(join(tmpdir(), "yinpinjianting-adversarial-"));
  const profileDir = join(tempDir, "persistent-profile");
  const dbPath = join(tempDir, "acceptance.sqlite");
  let backend = start(node, ["node_modules/tsx/dist/cli.mjs", "server/index.ts"], {
    AI_JOB_DB_PATH: dbPath,
    SERVER_PORT: String(backendPort),
    APP_CORS_ORIGIN: frontendUrl,
    HOST: "127.0.0.1",
  });
  start(node, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(frontendPort), "--configLoader", "runner"], {
    API_PROXY_TARGET: backendUrl,
  });

  const consoleErrors: string[] = [];
  try {
    await waitFor(`${backendUrl}/api/health`, "backend");
    console.log(`[adversarial-browser] active model: ${await requireRemoteModel()}`);
    await waitFor(frontendUrl, "frontend");
    let context = await launchPersistent(profileDir);
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().includes("Failed to load resource")) consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    await page.setViewportSize({ width: 1280, height: 720 });
    await registerAndSave(page);
    await requireRemoteCueCard(page);
    await page.screenshot({ path: join(artifactsDir, "desktop-success-1280x720.png"), fullPage: true });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText("简历：已导入")).toBeVisible();
    await expect(page.getByText("对抗验收用户")).toBeVisible();

    await context.close();
    context = await launchPersistent(profileDir);
    const reopened = await context.newPage();
    await reopened.goto(frontendUrl, { waitUntil: "domcontentloaded" });
    await expect(reopened.getByText("对抗验收用户")).toBeVisible();

    await stop(backend);
    await reopened.reload({ waitUntil: "domcontentloaded" });
    await expect(reopened.getByText(/同步失败|当前先展示本地状态/)).toBeVisible({ timeout: 15_000 });
    backend = start(node, ["node_modules/tsx/dist/cli.mjs", "server/index.ts"], {
      AI_JOB_DB_PATH: dbPath,
      SERVER_PORT: String(backendPort),
      APP_CORS_ORIGIN: frontendUrl,
      HOST: "127.0.0.1",
    });
    await waitFor(`${backendUrl}/api/health`, "restarted backend");
    console.log(`[adversarial-browser] restarted model: ${await requireRemoteModel()}`);
    await reopened.reload({ waitUntil: "domcontentloaded" });
    await expect(reopened.getByText("简历：已导入")).toBeVisible();
    await requireRemoteCueCard(reopened);
    await reopened.setViewportSize({ width: 390, height: 844 });
    await assertNoOverflow(reopened, "mobile");
    await reopened.screenshot({ path: join(artifactsDir, "mobile-success-390.png"), fullPage: true });
    await context.close();

    const anonymous = await chromium.launch({ headless: true });
    const anonymousContext = await anonymous.newContext({ locale: "zh-CN" });
    await verifyAnonymousAndDeniedMic(anonymousContext);
    await anonymousContext.close();
    await anonymous.close();

    if (consoleErrors.length) throw new Error(`console errors:\n${consoleErrors.join("\n")}`);
    console.log(JSON.stringify({ status: "pass", artifactsDir, dbPersisted: existsSync(dbPath), remoteModelRequired: true }, null, 2));
  } finally {
    await Promise.all(children.map((child) => stop(child)));
    try {
      rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (error) {
      // Windows can retain a Chromium profile handle after context.close().
      console.warn(`[adversarial-browser] temp cleanup skipped: ${String(error)}`);
    }
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
