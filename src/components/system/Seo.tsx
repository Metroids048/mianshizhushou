import { useEffect } from "react";
import { applySeo } from "../../lib/seo";

export function Seo({ title, description, image }: { title: string; description: string; image?: string }) {
  useEffect(() => {
    applySeo({ title, description, image });
  }, [title, description, image]);

  return null;
}
