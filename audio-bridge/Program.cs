using System.Text.Json;
using AudioBridge;

Console.OutputEncoding = System.Text.Encoding.UTF8;
Console.WriteLine("AI 求职台 · 音频桥");
Console.WriteLine("捕获系统播放音频（腾讯会议/飞书等），实时转发给网页端做真实面试辅助。");
Console.WriteLine();

using var cts = new CancellationTokenSource();
Console.CancelKeyPress += (_, e) =>
{
    e.Cancel = true;
    cts.Cancel();
};

var config = BridgeConfig.Load();
ApplyCommandLineArgs(config, args);

if (args.Any(arg => string.Equals(arg, "--reset", StringComparison.OrdinalIgnoreCase)))
{
    config.ClearToken();
    Console.WriteLine("已清除本机保存的音频桥凭证，请重新配对。");
}

if (string.IsNullOrWhiteSpace(config.DeviceToken))
{
    await PairAsync(config, cts.Token);
}

Console.WriteLine($"服务器地址：{config.ServerUrl}");
Console.WriteLine("按 Ctrl+C 退出。正在连接…");
Console.WriteLine();

await RunWithReconnectAsync(config, cts.Token);
return;

static void ApplyCommandLineArgs(BridgeConfig config, string[] args)
{
    for (var i = 0; i < args.Length; i++)
    {
        if (string.Equals(args[i], "--server", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length)
        {
            config.ServerUrl = args[i + 1].Trim();
            i++;
            continue;
        }
        if (string.Equals(args[i], "--device-name", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length)
        {
            config.DeviceName = args[i + 1].Trim();
            i++;
        }
    }
}

static async Task PairAsync(BridgeConfig config, CancellationToken ct)
{
    Console.Write("请输入网页端生成的 6 位配对码：");
    var code = Console.ReadLine()?.Trim() ?? "";
    using var http = new HttpClient { BaseAddress = new Uri(config.ServerUrl) };
    var client = new PairingClient(http);
    try
    {
        config.DeviceToken = await client.ClaimAsync(code, config.DeviceName, ct);
        config.Save();
        Console.WriteLine("配对成功，已保存本机凭证，之后启动将自动连接。");
    }
    catch (Exception ex)
    {
        Console.WriteLine($"配对失败：{ex.Message}");
        Environment.Exit(1);
    }
}

static async Task RunWithReconnectAsync(BridgeConfig config, CancellationToken ct)
{
    var backoffSeconds = 2;
    const int maxBackoffSeconds = 30;

    while (!ct.IsCancellationRequested)
    {
        try
        {
            await RunSessionAsync(config, ct);
            backoffSeconds = 2;
        }
        catch (OperationCanceledException)
        {
            break;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"连接中断：{ex.Message}");
        }

        if (ct.IsCancellationRequested) break;
        Console.WriteLine($"{backoffSeconds} 秒后重试连接…");
        try
        {
            await Task.Delay(TimeSpan.FromSeconds(backoffSeconds), ct);
        }
        catch (OperationCanceledException)
        {
            break;
        }
        backoffSeconds = Math.Min(backoffSeconds * 2, maxBackoffSeconds);
    }
}

static async Task RunSessionAsync(BridgeConfig config, CancellationToken ct)
{
    var deviceToken = config.DeviceToken
        ?? throw new InvalidOperationException("尚未配对，缺少设备凭证。");

    await using var stream = new BridgeStreamClient(
        onEvent: HandleEvent,
        onError: message => Console.WriteLine($"[错误] {message}"));

    await stream.ConnectAsync(config.ServerUrl, deviceToken, ct);
    Console.WriteLine("已连接，开始采集系统音频…");

    using var capture = new LoopbackCapture(
        onPcm16Chunk: pcm => _ = SendChunkAsync(stream, pcm, ct),
        onAudioLevel: level => _ = SendAudioLevelAsync(stream, level, ct),
        onError: message => Console.WriteLine($"[错误] {message}"));

    capture.Start();
    try
    {
        await stream.ReceiveLoopAsync(ct);
    }
    finally
    {
        capture.Stop();
    }
}

static async Task SendChunkAsync(BridgeStreamClient stream, byte[] pcm, CancellationToken ct)
{
    try
    {
        await stream.SendPcmAsync(pcm, ct);
    }
    catch
    {
        // 单帧发送失败不终止整个会话，交由接收循环/重连逻辑处理连接状态。
    }
}

static async Task SendAudioLevelAsync(BridgeStreamClient stream, AudioLevelSnapshot level, CancellationToken ct)
{
    try
    {
        await stream.SendControlAsync(new
        {
            type = "audio_level",
            rms = Math.Round(level.Rms, 4),
            peak = Math.Round(level.Peak, 4),
            bytesSent = level.BytesSent,
            sampleRate = level.SampleRate,
            channels = level.Channels
        }, ct);
        Console.WriteLine($"[音频] rms={level.Rms:0.0000}, peak={level.Peak:0.0000}, bytes={level.BytesSent}");
    }
    catch
    {
        // 音量状态只用于诊断，不影响主音频流。
    }
}

static void HandleEvent(string rawJson)
{
    try
    {
        using var doc = JsonDocument.Parse(rawJson);
        var type = doc.RootElement.TryGetProperty("type", out var typeProp) ? typeProp.GetString() : null;
        switch (type)
        {
            case "ready":
                Console.WriteLine("[就绪] 讯飞实时转写已连接。");
                break;
            case "interim":
                Console.WriteLine($"[实时] {doc.RootElement.GetProperty("text").GetString()}");
                break;
            case "final":
                Console.WriteLine($"[定稿] {doc.RootElement.GetProperty("text").GetString()}");
                break;
            case "error":
                Console.WriteLine($"[识别错误] {doc.RootElement.GetProperty("message").GetString()}");
                break;
            case "done":
                Console.WriteLine("[结束] 转写会话已关闭。");
                break;
        }
    }
    catch
    {
        // 忽略无法解析的事件
    }
}
