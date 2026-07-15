import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/chat/completions";
const API_PROXY_TARGET = process.env.API_PROXY_TARGET ?? "http://127.0.0.1:8897";

function deepseekProxy() {
  let apiKey = "";

  const handle = async (req, res, next) => {
    if (req.method !== "POST" || !req.url || !req.url.startsWith("/api/llm/chat")) {
      next();
      return;
    }
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    if (!apiKey) {
      res.statusCode = 503;
      res.end(JSON.stringify({ error: "LLM_NOT_CONFIGURED" }));
      return;
    }
    try {
      let body = "";
      for await (const chunk of req) body += chunk;
      const upstream = await fetch(DEEPSEEK_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body,
      });
      const text = await upstream.text();
      res.statusCode = upstream.status;
      res.end(text);
    } catch (error) {
      res.statusCode = 502;
      res.end(JSON.stringify({ error: "LLM_PROXY_ERROR", message: String(error) }));
    }
  };

  return {
    name: "deepseek-llm-proxy",
    config(_config, { mode }) {
      apiKey = loadEnv(mode, ".", "").DEEPSEEK_API_KEY ?? "";
    },
    configureServer(server) {
      server.middlewares.use(handle);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handle);
    },
  };
}

function onnxRuntimeModules() {
  const publicOnnxDir = join(process.cwd(), "public", "onnx");

  const handle = async (req, res, next) => {
    const pathname = req.url?.split("?")[0] ?? "";
    if (!pathname.startsWith("/onnx/") || !pathname.endsWith(".mjs")) {
      next();
      return;
    }
    try {
      const filename = pathname.replace("/onnx/", "");
      if (!/^ort-wasm-simd-threaded(?:\.(?:asyncify|jsep|jspi))?\.mjs$/.test(filename)) {
        next();
        return;
      }
      const content = await readFile(join(publicOnnxDir, filename), "utf8");
      res.setHeader("Content-Type", "text/javascript; charset=utf-8");
      res.end(content);
    } catch {
      next();
    }
  };

  return {
    name: "onnx-runtime-module-assets",
    configureServer(server) {
      server.middlewares.use(handle);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handle);
    },
  };
}

export default defineConfig({
  base: "/",
  plugins: [react(), onnxRuntimeModules(), deepseekProxy()],
  server: {
    proxy: {
      "/api": {
        target: API_PROXY_TARGET,
        changeOrigin: true,
      },
    },
  },
  build: {
    // mammoth/pdfjs Node-only import branches (isNodeRuntime() check, never true in a browser
    // build) and the vad/onnxruntime ML runtime are inherently >500kB; real users never fetch
    // the Node-only chunks, so this limit reflects what actually ships to the browser.
    chunkSizeWarningLimit: 520,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("onnxruntime-web") || id.includes("@ricky0123")) return "vad-vendor";
          if (id.includes("react-dom") || id.includes("/react/") || id.includes("scheduler")) return "react-vendor";
          if (id.includes("lucide-react")) return "icons-vendor";
          if (id.includes("zod")) return "zod-vendor";
          return undefined;
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: true,
    testTimeout: 15000,
  },
});
