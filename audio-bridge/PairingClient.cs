using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace AudioBridge;

internal sealed class PairingClient(HttpClient http)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<string> ClaimAsync(string pairingCode, string deviceName, CancellationToken ct)
    {
        var response = await http.PostAsJsonAsync(
            "/api/audio-bridge/claim",
            new { pairingCode, deviceName },
            JsonOptions,
            ct);

        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException($"配对码兑换失败 ({(int)response.StatusCode}): {body}");
        }

        var payload = await response.Content.ReadFromJsonAsync<ClaimResponse>(JsonOptions, ct)
            ?? throw new InvalidOperationException("配对码兑换响应格式异常。");
        return payload.DeviceToken;
    }

    private sealed record ClaimResponse([property: JsonPropertyName("deviceToken")] string DeviceToken);
}
