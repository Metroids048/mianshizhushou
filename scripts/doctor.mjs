import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const minNodeMajor = 20;
const envExamplePath = join(root, ".env.example");
const envPath = join(root, ".env");
const logsDir = join(root, "logs");
const dataDir = join(root, ".data");

const requiredPackages = [
  { name: "vite", entry: join(root, "node_modules", "vite", "bin", "vite.js") },
  { name: "tsx", entry: join(root, "node_modules", "tsx", "dist", "cli.mjs") },
  { name: "eslint", entry: join(root, "node_modules", "eslint", "bin", "eslint.js") },
  { name: "typescript", entry: join(root, "node_modules", "typescript", "bin", "tsc") },
  { name: "vitest", entry: join(root, "node_modules", "vitest", "vitest.mjs") },
];

function log(message) {
  console.log(`[doctor] ${message}`);
}

function fail(message) {
  console.error(`[doctor] ${message}`);
  process.exit(1);
}

function ensureNodeVersion() {
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  if (!Number.isFinite(major) || major < minNodeMajor) {
    fail(`Node.js ${process.versions.node} is too old. Install Node.js ${minNodeMajor}+ first.`);
  }
  log(`Node.js ${process.versions.node} OK`);
}

function ensureEnv() {
  if (!existsSync(envPath) && existsSync(envExamplePath)) {
    copyFileSync(envExamplePath, envPath);
    log("Created .env from .env.example");
  }
}

function ensureDirs() {
  mkdirSync(logsDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
}

function hasInstallArtifacts() {
  const modulesDir = join(root, "node_modules");
  if (!existsSync(modulesDir)) return false;
  const names = readdirSync(modulesDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  return names.length > 0;
}

function hasRequiredEntries() {
  return requiredPackages.every((pkg) => existsSync(pkg.entry));
}

function installDependencies() {
  for (const command of [
    { args: ["ci"], label: "npm ci" },
    { args: ["install"], label: "npm install" },
  ]) {
    log(`Running ${command.label} ...`);
    const result = spawnSync(npm, command.args, {
      cwd: root,
      stdio: "inherit",
      shell: false,
    });
    if (result.status === 0 && hasRequiredEntries()) {
      log(`${command.label} completed`);
      return;
    }
    log(`${command.label} did not fully recover dependencies`);
  }
  fail("Dependencies are still incomplete after reinstall.");
}

function ensureDependencies() {
  const modulesDir = join(root, "node_modules");
  const hasModules = existsSync(modulesDir) && hasInstallArtifacts();
  const complete = hasModules && hasRequiredEntries();

  if (complete) {
    log("Dependencies look complete");
    return;
  }

  if (!hasModules) {
    log("node_modules missing, installing dependencies");
  } else {
    const missing = requiredPackages.filter((pkg) => !existsSync(pkg.entry)).map((pkg) => pkg.name);
    log(`Dependencies incomplete, missing: ${missing.join(", ")}`);
  }

  installDependencies();
}

function checkSqliteRuntime() {
  const probe = spawnSync(process.execPath, [
    "-e",
    "const Database=require('better-sqlite3'); const db=new Database(':memory:'); db.prepare('select 1').get(); db.close();",
  ], {
    cwd: root,
    encoding: "utf8",
    shell: false,
  });

  if (probe.status === 0) {
    log("SQLite runtime OK");
    return;
  }

  log("SQLite runtime unavailable, trying npm rebuild better-sqlite3 ...");
  const rebuild = spawnSync(npm, ["rebuild", "better-sqlite3"], {
    cwd: root,
    stdio: "inherit",
    shell: false,
  });

  if (rebuild.status === 0) {
    const retry = spawnSync(process.execPath, [
      "-e",
      "const Database=require('better-sqlite3'); const db=new Database(':memory:'); db.prepare('select 1').get(); db.close();",
    ], {
      cwd: root,
      stdio: "ignore",
      shell: false,
    });
    if (retry.status === 0) {
      log("SQLite runtime recovered after rebuild");
      return;
    }
  }

  log("SQLite native binding still unavailable. Backend will fall back to file storage.");
}

function checkProductionSecrets() {
  if (process.env.NODE_ENV !== "production") return;
  const jwtSecret = process.env.JWT_SECRET?.trim();
  if (!jwtSecret) {
    fail("NODE_ENV=production requires JWT_SECRET to be set.");
  }
  if (jwtSecret.length < 32) {
    fail("JWT_SECRET should be at least 32 characters in production.");
  }
  log("Production JWT_SECRET configured");
}

function main() {
  process.chdir(root);
  ensureNodeVersion();
  ensureEnv();
  ensureDirs();
  ensureDependencies();
  checkSqliteRuntime();
  checkProductionSecrets();
  log("Environment is ready");
}

main();
