type MetaConfig = {
  title: string;
  description: string;
  image?: string;
};

const DEFAULT_IMAGE = "/favicon.svg";

export function applySeo(config: MetaConfig): void {
  if (typeof document === "undefined") return;
  document.title = config.title;
  upsertMeta("name", "description", config.description);
  upsertMeta("property", "og:title", config.title);
  upsertMeta("property", "og:description", config.description);
  upsertMeta("property", "og:image", config.image ?? DEFAULT_IMAGE);
}

function upsertMeta(attr: "name" | "property", key: string, content: string): void {
  let node = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!node) {
    node = document.createElement("meta");
    node.setAttribute(attr, key);
    document.head.appendChild(node);
  }
  node.setAttribute("content", content);
}
