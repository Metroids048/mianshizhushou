import { Clipboard, Headphones, PlugZap, Radio, RotateCw, ShieldCheck, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  listAudioBridgeDevicesOnServer,
  requestAudioBridgePairingCode,
  revokeAudioBridgeDeviceOnServer,
  subscribeToAudioBridgeEvents,
  type AudioBridgeDevice,
  type AudioBridgeStreamEvent,
} from "../lib/apiClient";
import { repairText } from "../lib/copy";
import { describeRequestError } from "../lib/requestError";

function formatBridgeTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知时间";
  return date.toLocaleString("zh-CN", { hour12: false });
}

function bridgeErrorText(event: Extract<AudioBridgeStreamEvent, { type: "error" }>) {
  if (event.code === "ASR_NOT_CONFIGURED") return "服务端尚未配置实时语音识别，系统音频已接入但不能转写。请配置语音服务后重试。";
  return repairText(event.message || "系统音频转写出现异常，请检查音频桥和语音服务状态。");
}

function secondsUntil(value: string) {
  return Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / 1000));
}

export function AudioBridgePage({
  isLoggedIn,
  onRequireLogin,
  onOpenLive,
}: {
  isLoggedIn: boolean;
  onRequireLogin: () => void;
  onOpenLive: () => void;
}) {
  const [pairing, setPairing] = useState<{ pairingCode: string; expiresAt: string } | null>(null);
  const [pairingLoading, setPairingLoading] = useState(false);
  const [devices, setDevices] = useState<AudioBridgeDevice[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [deviceName, setDeviceName] = useState("");
  const [statusMessage, setStatusMessage] = useState("等待连接音频桥");
  const [errorMessage, setErrorMessage] = useState("");
  const [events, setEvents] = useState<Array<{ id: string; label: string; tone: "info" | "success" | "error"; createdAt: string }>>([]);
  const [remainingSec, setRemainingSec] = useState(0);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const bridgeCommand = useMemo(() => "dotnet run --project audio-bridge/AudioBridge.csproj", []);
  const visibleDevices = isLoggedIn ? devices : [];
  const isBridgeConnected = isLoggedIn && connected;

  const pushEvent = useCallback((label: string, tone: "info" | "success" | "error" = "info") => {
    setEvents((current) => [
      { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, label, tone, createdAt: new Date().toISOString() },
      ...current,
    ].slice(0, 8));
  }, []);

  const handleBridgeEvent = useCallback((event: AudioBridgeStreamEvent) => {
    if (event.type === "bridge_status") {
      setConnected(event.connected);
      setDeviceName(event.connected ? event.deviceName ?? "" : "");
      setStatusMessage(event.connected ? "音频桥已连接，正在等待会议声音" : "音频桥未连接");
      if (event.connected) {
        setPairing(null);
        setErrorMessage("");
        pushEvent(`已连接 ${event.deviceName || "音频桥设备"}`, "success");
      }
      return;
    }
    if (event.type === "ready") {
      setStatusMessage(`语音识别已就绪：${event.provider}`);
      setErrorMessage("");
      pushEvent("语音识别已就绪", "success");
      return;
    }
    if (event.type === "interim") {
      setStatusMessage(`实时转写：${repairText(event.text)}`);
      return;
    }
    if (event.type === "final") {
      pushEvent(`定稿：${repairText(event.text)}`, "success");
      return;
    }
    if (event.type === "error") {
      const message = bridgeErrorText(event);
      setErrorMessage(message);
      setStatusMessage("系统音频链路需要处理故障");
      pushEvent(message, "error");
    }
  }, [pushEvent]);

  const ensureSubscription = useCallback(() => {
    if (!isLoggedIn || unsubscribeRef.current) return;
    unsubscribeRef.current = subscribeToAudioBridgeEvents(handleBridgeEvent);
  }, [handleBridgeEvent, isLoggedIn]);

  const stopSubscription = useCallback(() => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    setConnected(false);
    setDeviceName("");
    setStatusMessage("已停止监听音频桥事件");
  }, []);

  const refreshDevices = useCallback(() => {
    if (!isLoggedIn) return;
    setDevicesLoading(true);
    void listAudioBridgeDevicesOnServer()
      .then((result) => setDevices(Array.isArray(result.devices) ? result.devices : []))
      .catch((error) => setErrorMessage(describeRequestError(error, "读取已配对设备失败。")))
      .finally(() => setDevicesLoading(false));
  }, [isLoggedIn]);

  useEffect(() => {
    if (!isLoggedIn) {
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      return;
    }
    ensureSubscription();
    const refreshTimer = window.setTimeout(refreshDevices, 0);
    return () => {
      window.clearTimeout(refreshTimer);
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
    };
  }, [ensureSubscription, isLoggedIn, refreshDevices]);

  useEffect(() => {
    if (!pairing) return undefined;
    const tick = () => {
      setRemainingSec(secondsUntil(pairing.expiresAt));
    };
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [pairing]);

  const startPairing = () => {
    if (!isLoggedIn) {
      onRequireLogin();
      return;
    }
    setPairingLoading(true);
    setErrorMessage("");
    ensureSubscription();
    void requestAudioBridgePairingCode()
      .then((result) => {
        setPairing(result);
        setRemainingSec(secondsUntil(result.expiresAt));
        setStatusMessage("配对码已生成，请在音频桥程序中输入");
        pushEvent("已生成新的 6 位配对码", "info");
      })
      .catch((error) => setErrorMessage(describeRequestError(error, "生成配对码失败。")))
      .finally(() => setPairingLoading(false));
  };

  const revokeDevice = (id: string) => {
    void revokeAudioBridgeDeviceOnServer(id)
      .then(() => {
        setDevices((current) => current.filter((device) => device.id !== id));
        pushEvent("已撤销一台音频桥设备", "info");
      })
      .catch((error) => setErrorMessage(describeRequestError(error, "撤销设备失败。")));
  };

  const copyPairingCode = () => {
    if (!pairing?.pairingCode || !navigator.clipboard) return;
    void navigator.clipboard.writeText(pairing.pairingCode).then(() => pushEvent("配对码已复制", "success"));
  };

  return (
    <section className="page desktop-page audio-bridge-page">
      <header className="desktop-page-header audio-bridge-header">
        <div className="desktop-page-title">
          <span className="page-eyebrow">会议监听</span>
          <h1>Windows 音频桥</h1>
          <p>连接本机系统音频，监听腾讯会议、飞书等会议软件里播放的面试官声音，再交给实时助手生成提词卡。</p>
        </div>
        <div className="record-report-actions">
          <button className="button secondary compact-button" type="button" onClick={refreshDevices} disabled={!isLoggedIn || devicesLoading}>
            <RotateCw size={14} />
            刷新设备
          </button>
          <button className="button primary compact-button" type="button" onClick={onOpenLive}>
            <Headphones size={14} />
            进入实时助手
          </button>
        </div>
      </header>

      <div className="audio-bridge-layout">
        <section className="surface-card audio-bridge-connect-card">
          <div className="surface-card-inner">
            <div className="section-row-header">
              <div>
                <span className="subtle-label">连接状态</span>
                <h2>{isBridgeConnected ? "正在监听系统音频" : "配对本机音频桥"}</h2>
              </div>
              <span className={isBridgeConnected ? "audio-bridge-status active" : "audio-bridge-status"}>
                <Radio size={14} />
                {isBridgeConnected ? deviceName || "已连接" : "未连接"}
              </span>
            </div>

            {!isLoggedIn ? (
              <div className="audio-bridge-login-state">
                <PlugZap size={22} />
                <div>
                  <strong>登录后连接会议监听</strong>
                  <p>音频桥设备和转写事件按账号隔离。登录后再生成配对码，避免会议音频串到其他账号。</p>
                </div>
                <button className="button primary" type="button" onClick={onRequireLogin}>
                  登录后连接
                </button>
              </div>
            ) : (
              <>
                <div className="audio-bridge-status-panel">
                  <span>当前状态</span>
                  <strong>{statusMessage}</strong>
                  {errorMessage ? <p className="inline-message error">{errorMessage}</p> : null}
                </div>

                <div className="audio-bridge-steps" aria-label="会议监听连接步骤">
                  <article className={pairing || isBridgeConnected ? "audio-bridge-step done" : "audio-bridge-step active"}>
                    <span>1</span>
                    <div>
                      <strong>生成配对码</strong>
                      <p>{pairing ? `配对码 ${pairing.pairingCode}，${remainingSec > 0 ? `${remainingSec} 秒后过期` : "已过期"}` : "点击下方按钮拿到本次连接码。"}</p>
                    </div>
                  </article>
                  <article className={isBridgeConnected ? "audio-bridge-step done" : pairing ? "audio-bridge-step active" : "audio-bridge-step"}>
                    <span>2</span>
                    <div>
                      <strong>启动本机音频桥</strong>
                      <p>在 Windows 本机音频桥中输入配对码，然后打开腾讯会议或飞书会议播放声音。</p>
                    </div>
                  </article>
                  <article className={isBridgeConnected ? "audio-bridge-step active" : "audio-bridge-step"}>
                    <span>3</span>
                    <div>
                      <strong>回到实时助手</strong>
                      <p>{isBridgeConnected ? "连接成功，去实时助手选择“系统音频”。" : "连接成功后，实时助手会接收系统音频转写。"}</p>
                    </div>
                  </article>
                </div>

                {pairing ? (
                  <div className="audio-bridge-code-card" aria-live="polite">
                    <span>6 位配对码</span>
                    <strong>{pairing.pairingCode}</strong>
                    <p>{remainingSec > 0 ? `${remainingSec} 秒后过期` : "配对码已过期，请重新生成。"}</p>
                    <button className="button secondary compact-button" type="button" onClick={copyPairingCode}>
                      <Clipboard size={14} />
                      复制
                    </button>
                  </div>
                ) : (
                  <button className="button primary large-button" type="button" onClick={startPairing} disabled={pairingLoading}>
                    <PlugZap size={18} />
                    {pairingLoading ? "正在生成配对码..." : "生成配对码"}
                  </button>
                )}

                <details className="audio-bridge-command">
                  <summary>高级信息：本地程序命令</summary>
                  <code>{bridgeCommand}</code>
                </details>

                <div className="audio-bridge-actions">
                  <button className="button secondary" type="button" onClick={stopSubscription} disabled={!isLoggedIn}>
                    停止监听事件
                  </button>
                  <button className="button secondary" type="button" onClick={startPairing} disabled={pairingLoading}>
                    重新生成配对码
                  </button>
                  <button className="button primary" type="button" onClick={onOpenLive} disabled={!isBridgeConnected}>
                    去实时助手选择系统音频
                  </button>
                </div>
              </>
            )}
          </div>
        </section>

        <aside className="surface-card audio-bridge-side-card">
          <div className="surface-card-inner">
            <div className="section-row-header">
              <div>
                <span className="subtle-label">设备</span>
                <h2>已配对设备</h2>
              </div>
              <ShieldCheck size={18} />
            </div>
            {visibleDevices.length > 0 ? (
              <div className="audio-bridge-device-list">
                {visibleDevices.map((device) => (
                  <article className="audio-bridge-device" key={device.id}>
                    <div>
                      <strong>{repairText(device.deviceName) || "音频桥设备"}</strong>
                      <p>最近连接：{formatBridgeTime(device.lastSeenAt)}</p>
                    </div>
                    <button className="icon-button danger" type="button" onClick={() => revokeDevice(device.id)} aria-label={`撤销 ${device.deviceName || "音频桥设备"}`}>
                      <Trash2 size={16} />
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <p className="muted-copy">{isLoggedIn ? "还没有已配对设备。生成配对码并启动本地音频桥后会出现在这里。" : "登录后查看本账号的音频桥设备。"}</p>
            )}
          </div>
        </aside>

        <section className="surface-card audio-bridge-events-card">
          <div className="surface-card-inner">
            <div className="section-row-header">
              <div>
                <span className="subtle-label">诊断</span>
                <h2>监听事件</h2>
              </div>
            </div>
            {events.length > 0 ? (
              <div className="audio-bridge-event-list">
                {events.map((event) => (
                  <article key={event.id} className={`audio-bridge-event ${event.tone}`}>
                    <span>{formatBridgeTime(event.createdAt)}</span>
                    <p>{event.label}</p>
                  </article>
                ))}
              </div>
            ) : (
              <p className="muted-copy">生成配对码、连接音频桥或收到转写错误后，这里会显示诊断记录。</p>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}
