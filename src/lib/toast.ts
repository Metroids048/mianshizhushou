// 轻量全局提示通道（上线收口 A2）：任意模块可在不依赖组件 props 的情况下触发统一提示。
export type ToastTone = "info" | "success" | "error";

export interface ToastMessage {
  id: number;
  text: string;
  tone: ToastTone;
}

type Listener = (toast: ToastMessage) => void;

const listeners = new Set<Listener>();
let counter = 0;

export function notify(text: string, tone: ToastTone = "info"): void {
  counter += 1;
  const toast: ToastMessage = { id: counter, text, tone };
  listeners.forEach((listener) => listener(toast));
}

export function subscribeToast(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
