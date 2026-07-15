import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const children = [];

function runDoctor() {
  const result = spawn(npm, ["run", "doctor"], {
    cwd: root,
    stdio: "inherit",
    shell: false,
  });
  return new Promise((resolve, reject) => {
    result.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`doctor terminated by ${signal}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`doctor exited with code ${code}`));
        return;
      }
      resolve(undefined);
    });
    result.on("error", reject);
  });
}

function run(script) {
  const child = spawn(npm, ["run", script], {
    cwd: root,
    stdio: "inherit",
    shell: false,
  });
  children.push(child);
  child.on("exit", (code, signal) => {
    if (signal) return;
    if (code !== 0 && code !== null) {
      shutdown(code);
    }
  });
  return child;
}

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

(async () => {
  console.log("[start-dev] 检查本地环境…");
  await runDoctor();
  console.log("[start-dev] 启动后端与前端…");
  run("server");
  run("dev");
})().catch((error) => {
  console.error(`[start-dev] ${String(error)}`);
  shutdown(1);
});
