using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace AudioBridge;

// 用长期设备令牌连接后端摄取路由，把 PCM 分帧成与浏览器端一致的 1280 字节分片。
// 连接断开时由上层 Program.cs 负责退避重连，这里只管单次连接的生命周期。
internal sealed class BridgeStreamClient : IAsyncDisposable
{
    private const int ChunkSize = 1280;

    private readonly ClientWebSocket _socket = new();
    private readonly Action<string> _onEvent;
    private readonly Action<string> _onError;
    private readonly List<byte> _pending = [];
    private readonly SemaphoreSlim _sendLock = new(1, 1);

    public BridgeStreamClient(Action<string> onEvent, Action<string> onError)
    {
        _onEvent = onEvent;
        _onError = onError;
    }

    public async Task ConnectAsync(string serverUrl, string deviceToken, CancellationToken ct)
    {
        var wsUri = ToWebSocketUri(serverUrl, deviceToken);
        _socket.Options.SetRequestHeader("Authorization", $"Bearer {deviceToken}");
        await _socket.ConnectAsync(wsUri, ct);
    }

    public async Task SendPcmAsync(byte[] pcm, CancellationToken ct)
    {
        _pending.AddRange(pcm);
        while (_pending.Count >= ChunkSize)
        {
            var chunk = _pending.GetRange(0, ChunkSize);
            _pending.RemoveRange(0, ChunkSize);
            await SendBinaryAsync(chunk.ToArray(), ct);
        }
    }

    public async Task SendEndAsync(CancellationToken ct)
    {
        if (_pending.Count > 0)
        {
            await SendBinaryAsync(_pending.ToArray(), ct);
            _pending.Clear();
        }
        var payload = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { end = true }));
        await SendLockedAsync(() => _socket.SendAsync(payload, WebSocketMessageType.Text, true, ct), ct);
    }

    public async Task SendControlAsync(object payload, CancellationToken ct)
    {
        var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload));
        await SendLockedAsync(() => _socket.SendAsync(bytes, WebSocketMessageType.Text, true, ct), ct);
    }

    // 监听服务端转发的识别事件（ready/interim/final/error/done），驱动整个连接的生命周期。
    public async Task ReceiveLoopAsync(CancellationToken ct)
    {
        var buffer = new byte[8192];
        while (_socket.State == WebSocketState.Open && !ct.IsCancellationRequested)
        {
            using var stream = new MemoryStream();
            WebSocketReceiveResult result;
            do
            {
                result = await _socket.ReceiveAsync(buffer, ct);
                if (result.MessageType == WebSocketMessageType.Close) return;
                stream.Write(buffer, 0, result.Count);
            } while (!result.EndOfMessage);

            var text = Encoding.UTF8.GetString(stream.ToArray());
            _onEvent(text);
        }
    }

    private async Task SendBinaryAsync(byte[] chunk, CancellationToken ct)
    {
        await SendLockedAsync(() => _socket.SendAsync(chunk, WebSocketMessageType.Binary, true, ct), ct);
    }

    private async Task SendLockedAsync(Func<Task> send, CancellationToken ct)
    {
        await _sendLock.WaitAsync(ct);
        try
        {
            if (_socket.State == WebSocketState.Open) await send();
        }
        catch (Exception ex)
        {
            _onError($"发送音频数据失败：{ex.Message}");
        }
        finally
        {
            _sendLock.Release();
        }
    }

    private static Uri ToWebSocketUri(string serverUrl, string deviceToken)
    {
        var httpUri = new Uri(serverUrl);
        var scheme = httpUri.Scheme == "https" ? "wss" : "ws";
        var builder = new UriBuilder(httpUri) { Scheme = scheme, Path = "/api/audio-bridge/stream" };
        builder.Query = $"token={Uri.EscapeDataString(deviceToken)}";
        return builder.Uri;
    }

    public async ValueTask DisposeAsync()
    {
        if (_socket.State == WebSocketState.Open)
        {
            try
            {
                await _socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "done", CancellationToken.None);
            }
            catch
            {
                // Best-effort close
            }
        }
        _socket.Dispose();
        _sendLock.Dispose();
    }
}
