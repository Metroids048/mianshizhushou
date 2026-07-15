import { render, screen, act } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ToastHost } from "./ToastHost";
import { notify } from "../../lib/toast";

describe("ToastHost", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("展示通过 notify 触发的全局提示", async () => {
    render(<ToastHost />);
    expect(screen.queryByRole("region", { name: "系统提示" })).not.toBeInTheDocument();

    act(() => {
      notify("网络连接失败，请检查网络后重试", "error");
    });

    expect(await screen.findByText("网络连接失败，请检查网络后重试")).toBeInTheDocument();
  });
});
