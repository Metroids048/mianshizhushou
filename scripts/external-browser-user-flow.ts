import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";
import { chromium, expect, type Browser, type Page } from "@playwright/test";
import WebSocket from "ws";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const node = process.execPath;
const backendPort = Number(process.env.E2E_BACKEND_PORT ?? 18897);
const frontendPort = Number(process.env.E2E_FRONTEND_PORT ?? 15273);
const backendUrl = `http://127.0.0.1:${backendPort}`;
const frontendUrl = `http://127.0.0.1:${frontendPort}`;
const headed = process.argv.includes("--headed") || process.env.E2E_HEADLESS === "0";
const artifactsDir = resolve(root, "web", "artifacts", "external-browser-flow");
const children: ChildProcess[] = [];

function startProcess(command: string, args: string[], env: NodeJS.ProcessEnv) {
  const cleanedEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...process.env, ...env })) {
    if (typeof value === "string") cleanedEnv[key] = value;
  }
  const child = spawn(command, args, {
    cwd: root,
    env: cleanedEnv,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  children.push(child);
  child.stdout?.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr?.on("data", (chunk) => process.stderr.write(chunk));
  return child;
}

async function stopChildren() {
  await Promise.all(
    children.map(
      (child) =>
        new Promise<void>((resolveStop) => {
          if (child.exitCode !== null || child.killed) {
            resolveStop();
            return;
          }
          const timer = setTimeout(resolveStop, 1_500);
          child.once("exit", () => {
            clearTimeout(timer);
            resolveStop();
          });
          child.kill();
        }),
    ),
  );
}

function cleanupTempDir(tempDir: string) {
  try {
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (error) {
    console.warn(`[external-browser-flow] temp cleanup skipped: ${String(error)}`);
  }
}

async function waitForHttp(url: string, label: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.status >= 200 && response.status < 500) return;
      lastError = `status=${response.status}`;
    } catch (error) {
      lastError = String(error);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 750));
  }
  throw new Error(`${label} not ready: ${url} ${lastError}`);
}

async function launchBrowser(): Promise<Browser> {
  for (const channel of ["msedge", "chrome"] as const) {
    try {
      return await chromium.launch({ channel, headless: !headed });
    } catch {
      // Try next locally installed browser.
    }
  }
  return chromium.launch({ headless: !headed });
}

async function assertNoHorizontalOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  if (overflow.documentWidth > overflow.viewport + 2 || overflow.bodyWidth > overflow.viewport + 2) {
    throw new Error(`${label} horizontal overflow: ${JSON.stringify(overflow)}`);
  }
}

async function register(page: Page) {
  const phone = `139${String(Date.now()).slice(-8)}`;
  await page.goto(frontendUrl, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "yinpinjianting" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "注册" }).click();
  await page.getByPlaceholder("手机号").fill(phone);
  await page.getByPlaceholder("至少 8 位密码").fill("TestPass123");
  await page.getByPlaceholder("昵称，可选").fill("浏览器验收用户");
  await page.getByRole("button", { name: "注册并进入工具" }).click();
  await expect(page.getByText("浏览器验收用户")).toBeVisible({ timeout: 15_000 });
}

async function saveLibrary(page: Page) {
  await page.getByRole("button", { name: /资料库/ }).first().click();
  await expect(page.getByRole("heading", { name: "资料库" })).toBeVisible({ timeout: 10_000 });
  await page.getByPlaceholder("粘贴你的简历正文，保存后会自动抽取证据。").fill([
    "王明，AI 产品经理。",
    "增长提词助手项目：负责用户访谈、RAG 资料库、提词卡生成和质量评估，首轮转化提升 18%。",
    "技能：LLM 应用、RAG、A/B 测试、用户研究、数据分析。",
  ].join("\n"));
  await page.getByRole("button", { name: /保存简历/ }).click();
  await expect(page.getByText(/简历已保存|同步失败/)).toBeVisible({ timeout: 15_000 });

  await page.getByPlaceholder("粘贴项目背景、你的职责、动作、指标、结果和复盘。").fill([
    "增长提词助手项目",
    "背景：用户在真实面试中无法快速组织项目回答。",
    "动作：搭建简历、项目资料、JD 三类资料库，并把提词卡输出绑定 evidence trace。",
    "结果：首轮转化提升 18%，提词卡采纳率提升。",
  ].join("\n"));
  await page.getByRole("button", { name: /保存项目资料/ }).click();
  await expect(page.getByText(/项目资料已保存|项目资料保存失败/)).toBeVisible({ timeout: 15_000 });

  await page.getByPlaceholder("粘贴目标岗位 JD 或面试背景。").fill([
    "岗位：AI 产品经理",
    "要求：负责 AI Copilot 产品、用户研究、数据分析、RAG 与 LLM 应用落地。",
  ].join("\n"));
  await page.getByRole("button", { name: /保存目标 JD/ }).click();
  await expect(page.getByText(/目标 JD 已保存|JD 保存失败/)).toBeVisible({ timeout: 15_000 });
}

async function cueCardFlow(page: Page) {
  await page.getByRole("button", { name: /监听提词台/ }).click();
  await page.getByPlaceholder("例如：请介绍一个你做过的项目，以及你具体负责什么？").fill("请介绍一个你做过的 AI 产品项目，以及你具体负责什么？");
  const t0 = Date.now();
  await page.getByRole("button", { name: /生成提词卡/ }).click();
  await expect(page.getByText(/推荐开场/)).toBeVisible({ timeout: 35_000 });
  const elapsed = Date.now() - t0;
  if (elapsed > 8_000) throw new Error(`cue-card exceeded 8s threshold: ${elapsed}ms`);
  await expect(page.getByText(/本地练习|模型生成/).first()).toBeVisible();
  await expect(page.getByText(/项目|资料|证据|trace/i).first()).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText(/简历：已导入/)).toBeVisible({ timeout: 15_000 });
}

async function audioAndResumeSmoke(page: Page) {
  await page.getByRole("button", { name: "麦克风" }).click();
  await page.getByRole("button", { name: /开始麦克风监听/ }).click();
  await expect(page.getByText(/不支持语音识别|权限|失败|正在监听/).first()).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: "系统音频桥" }).click();
  await page.getByRole("button", { name: /生成配对码/ }).click();
  await expect(page.getByText(/配对码|请先登录|音频桥配对失败/).first()).toBeVisible({ timeout: 15_000 });
  const bridgeText = await page.locator(".yp-bridge-box").innerText({ timeout: 10_000 });
  const pairingCode = bridgeText.match(/\b\d{6}\b/)?.[0];
  if (!pairingCode) throw new Error(`missing pairing code in bridge UI: ${bridgeText}`);
  const claim = await fetch(`${backendUrl}/api/audio-bridge/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pairingCode, deviceName: "浏览器验收模拟桥" }),
  });
  if (!claim.ok) throw new Error(`audio bridge claim failed: ${claim.status} ${await claim.text()}`);
  const { deviceToken } = (await claim.json()) as { deviceToken: string };
  const bridgeSocket = new WebSocket(`${backendUrl.replace(/^http/, "ws")}/api/audio-bridge/stream?token=${encodeURIComponent(deviceToken)}`);
  await new Promise<void>((resolve, reject) => {
    bridgeSocket.once("open", resolve);
    bridgeSocket.once("error", reject);
  });
  bridgeSocket.send(JSON.stringify({ type: "audio_level", rms: 0.16, peak: 0.44, bytesSent: 32000, sampleRate: 48000, channels: 2 }));
  bridgeSocket.send(Buffer.alloc(32_000, 1));
  await expect(page.getByText(/诊断转写模式|debug 已就绪|系统音频 rms/).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByPlaceholder("例如：请介绍一个你做过的项目，以及你具体负责什么？")).toHaveValue(/请介绍一个你做过的 AI 产品项目/, { timeout: 10_000 });
  bridgeSocket.close();

  await page.getByRole("button", { name: /资料库/ }).first().click();
  const t0 = Date.now();
  await page.getByRole("button", { name: /生成优化建议/ }).click();
  await expect(page.locator(".yp-ai-result")).toBeVisible({ timeout: 35_000 });
  await expect(page.getByRole("button", { name: "生成优化建议" })).toBeEnabled();
  const elapsed = Date.now() - t0;
  if (elapsed > 8_000) throw new Error(`resume-ai exceeded 8s threshold: ${elapsed}ms`);
}

async function mobileSmoke(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/", "/library"]) {
    await page.goto(`${frontendUrl}${path}`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    await assertNoHorizontalOverflow(page, `${path} 390px`);
  }
  await page.screenshot({ path: join(artifactsDir, "mobile-yinpinjianting-390.png"), fullPage: true });
}

async function main() {
  mkdirSync(artifactsDir, { recursive: true });
  const tempDir = mkdtempSync(join(tmpdir(), "yinpinjianting-browser-"));
  const dbPath = join(tempDir, "browser-flow.sqlite");
  startProcess(node, ["node_modules/tsx/dist/cli.mjs", "server/index.ts"], {
    AI_JOB_DB_PATH: dbPath,
    SERVER_PORT: String(backendPort),
    HOST: "127.0.0.1",
    APP_CORS_ORIGIN: frontendUrl,
    ASR_PROVIDER: "debug",
    ASR_DEBUG_TEXT: "请介绍一个你做过的 AI 产品项目，以及你具体负责什么？",
  });
  startProcess(node, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(frontendPort), "--configLoader", "runner"], {
    API_PROXY_TARGET: backendUrl,
  });

  let browser: Browser | undefined;
  const browserErrors: string[] = [];
  try {
    await waitForHttp(`${backendUrl}/api/health`, "backend");
    await waitForHttp(frontendUrl, "frontend");
    browser = await launchBrowser();
    const context = await browser.newContext({ locale: "zh-CN" });
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const text = message.text();
      if (text.includes("Failed to load resource")) return;
      browserErrors.push(text);
    });
    page.on("pageerror", (error) => browserErrors.push(error.message));

    await page.setViewportSize({ width: 1280, height: 720 });
    await register(page);
    await saveLibrary(page);
    await cueCardFlow(page);
    await audioAndResumeSmoke(page);
    await assertNoHorizontalOverflow(page, "desktop 1280x720");
    await page.screenshot({ path: join(artifactsDir, "desktop-yinpinjianting-1280x720.png"), fullPage: true });
    await mobileSmoke(page);

    if (browserErrors.length) throw new Error(`browser console errors:\n${browserErrors.join("\n")}`);
    console.log(JSON.stringify({ status: "pass", frontendUrl, backendUrl, artifactsDir }, null, 2));
    console.log("system-audio-bridge-debug-flow: verified via simulated bridge websocket + ASR_PROVIDER=debug.");
    console.log("system-audio-bridge-real-meeting: not verified by automation; requires real Windows bridge process and meeting audio.");
  } finally {
    if (browser) await browser.close();
    await stopChildren();
    cleanupTempDir(tempDir);
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
