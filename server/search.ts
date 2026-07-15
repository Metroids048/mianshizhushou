import type { SearchResult } from "./types";
import { makeId, nowIso } from "./utils";

const SEARCH_TIMEOUT_MS = 4000;

export interface SearchTool {
  provider: SearchResult["provider"];
  search(query: string): Promise<SearchResult[]>;
}

export function createSearchTool(provider = process.env.SEARCH_PROVIDER ?? "", apiKey = process.env.SEARCH_API_KEY ?? ""): SearchTool {
  const normalized = provider.toLowerCase();
  if (!apiKey || !["tavily", "bing", "serpapi"].includes(normalized)) {
    return {
      provider: "disabled",
      async search(query) {
        return [
          {
            id: makeId("search-disabled"),
            query,
            title: "联网搜索未配置",
            url: "",
            snippet: "未配置 SEARCH_PROVIDER/SEARCH_API_KEY，本次仅使用本地简历、JD 和问题库上下文。",
            provider: "disabled",
            createdAt: nowIso(),
          },
        ];
      },
    };
  }

  return {
    provider: normalized as SearchResult["provider"],
    async search(query) {
      if (normalized === "tavily") return searchTavily(query, apiKey);
      if (normalized === "bing") return searchBing(query, apiKey);
      return searchSerpApi(query, apiKey);
    },
  };
}

async function searchTavily(query: string, apiKey: string): Promise<SearchResult[]> {
  const response = await fetchWithSearchTimeout("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey, query, max_results: 5, search_depth: "basic" }),
  });
  const data = (await response.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
  return mapResults(query, "tavily", data.results ?? []);
}

async function searchBing(query: string, apiKey: string): Promise<SearchResult[]> {
  const response = await fetchWithSearchTimeout(`https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(query)}&count=5`, {
    headers: { "Ocp-Apim-Subscription-Key": apiKey },
  });
  const data = (await response.json()) as { webPages?: { value?: Array<{ name?: string; url?: string; snippet?: string }> } };
  return mapResults(query, "bing", data.webPages?.value ?? []);
}

async function searchSerpApi(query: string, apiKey: string): Promise<SearchResult[]> {
  const response = await fetchWithSearchTimeout(`https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${apiKey}&num=5`);
  const data = (await response.json()) as { organic_results?: Array<{ title?: string; link?: string; snippet?: string }> };
  return mapResults(
    query,
    "serpapi",
    (data.organic_results ?? []).map((item) => ({ title: item.title, url: item.link, snippet: item.snippet })),
  );
}

async function fetchWithSearchTimeout(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("SEARCH_TIMEOUT")), SEARCH_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function mapResults(query: string, provider: SearchResult["provider"], items: Array<{ title?: string; name?: string; url?: string; link?: string; snippet?: string; content?: string }>): SearchResult[] {
  return items.slice(0, 5).map((item) => ({
    id: makeId("search"),
    query,
    title: item.title ?? item.name ?? "未命名结果",
    url: item.url ?? item.link ?? "",
    snippet: item.snippet ?? item.content ?? "",
    provider,
    createdAt: nowIso(),
  }));
}
