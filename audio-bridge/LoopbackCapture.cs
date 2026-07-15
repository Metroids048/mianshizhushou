using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace AudioBridge;

// 捕获当前默认播放设备的系统音频（WASAPI loopback），重采样为 16kHz 单通道 PCM16，
// 采样算法与浏览器端 src/lib/speech.ts 的 downsampleTo16kPcm 保持一致（最近邻重采样）。
internal sealed class LoopbackCapture : IDisposable
{
    public const int TargetSampleRate = 16000;

    private readonly WasapiLoopbackCapture _capture;
    private readonly Action<byte[]> _onPcm16Chunk;
    private readonly Action<AudioLevelSnapshot> _onAudioLevel;
    private readonly Action<string> _onError;
    private readonly object _levelLock = new();
    private DateTime _lastLevelAt = DateTime.UtcNow;
    private long _bytesSinceLastLevel;
    private double _sumSquaresSinceLastLevel;
    private int _samplesSinceLastLevel;
    private float _peakSinceLastLevel;

    public LoopbackCapture(Action<byte[]> onPcm16Chunk, Action<AudioLevelSnapshot> onAudioLevel, Action<string> onError)
    {
        _onPcm16Chunk = onPcm16Chunk;
        _onAudioLevel = onAudioLevel;
        _onError = onError;
        _capture = new WasapiLoopbackCapture();
        _capture.DataAvailable += OnDataAvailable;
        _capture.RecordingStopped += OnRecordingStopped;
    }

    public void Start() => _capture.StartRecording();

    public void Stop() => _capture.StopRecording();

    private void OnDataAvailable(object? sender, WaveInEventArgs e)
    {
        if (e.BytesRecorded == 0) return;
        var sourceFormat = _capture.WaveFormat;
        var floatSamples = ToMonoFloat(e.Buffer, e.BytesRecorded, sourceFormat);
        var pcm16 = DownsampleToPcm16(floatSamples, sourceFormat.SampleRate);
        if (pcm16.Length > 0) _onPcm16Chunk(pcm16);
        RecordAudioLevel(floatSamples, pcm16.Length, sourceFormat);
    }

    private void OnRecordingStopped(object? sender, StoppedEventArgs e)
    {
        if (e.Exception != null) _onError($"系统音频采集异常停止：{e.Exception.Message}");
    }

    // WASAPI loopback 通常是 32-bit float，按声道数取平均混为单通道。
    private static float[] ToMonoFloat(byte[] buffer, int bytesRecorded, WaveFormat format)
    {
        var channels = Math.Max(1, format.Channels);
        var bytesPerSample = format.BitsPerSample / 8;
        var frameSize = bytesPerSample * channels;
        var frameCount = bytesRecorded / frameSize;
        var output = new float[frameCount];

        for (var frame = 0; frame < frameCount; frame++)
        {
            var frameOffset = frame * frameSize;
            var sum = 0f;
            for (var channel = 0; channel < channels; channel++)
            {
                var sampleOffset = frameOffset + channel * bytesPerSample;
                sum += ReadFloatSample(buffer, sampleOffset, format);
            }
            output[frame] = sum / channels;
        }
        return output;
    }

    private static float ReadFloatSample(byte[] buffer, int offset, WaveFormat format)
    {
        if (format.Encoding == WaveFormatEncoding.IeeeFloat && format.BitsPerSample == 32)
        {
            return BitConverter.ToSingle(buffer, offset);
        }
        if (format.BitsPerSample == 16)
        {
            return BitConverter.ToInt16(buffer, offset) / 32768f;
        }
        if (format.BitsPerSample == 32)
        {
            return BitConverter.ToInt32(buffer, offset) / 2147483648f;
        }
        return 0f;
    }

    // 最近邻重采样到 16kHz，与前端 downsampleTo16kPcm 算法一致，输出 Int16 小端 PCM。
    private static byte[] DownsampleToPcm16(float[] input, int inputSampleRate)
    {
        if (input.Length == 0) return [];
        var ratio = (double)inputSampleRate / TargetSampleRate;
        var outputLength = Math.Max(1, (int)Math.Floor(input.Length / ratio));
        var output = new byte[outputLength * 2];

        for (var i = 0; i < outputLength; i++)
        {
            var sourceIndex = (int)Math.Floor(i * ratio);
            if (sourceIndex >= input.Length) sourceIndex = input.Length - 1;
            var sample = Math.Clamp(input[sourceIndex], -1f, 1f);
            var scaled = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
            var value = (short)scaled;
            output[i * 2] = (byte)(value & 0xFF);
            output[i * 2 + 1] = (byte)((value >> 8) & 0xFF);
        }
        return output;
    }

    public void Dispose()
    {
        _capture.DataAvailable -= OnDataAvailable;
        _capture.RecordingStopped -= OnRecordingStopped;
        _capture.Dispose();
    }

    private void RecordAudioLevel(float[] samples, int bytesSent, WaveFormat format)
    {
        lock (_levelLock)
        {
            foreach (var sample in samples)
            {
                var abs = Math.Abs(sample);
                _sumSquaresSinceLastLevel += sample * sample;
                _samplesSinceLastLevel += 1;
                if (abs > _peakSinceLastLevel) _peakSinceLastLevel = abs;
            }
            _bytesSinceLastLevel += bytesSent;

            var now = DateTime.UtcNow;
            if ((now - _lastLevelAt).TotalMilliseconds < 1000) return;
            var rms = _samplesSinceLastLevel > 0 ? Math.Sqrt(_sumSquaresSinceLastLevel / _samplesSinceLastLevel) : 0;
            _onAudioLevel(new AudioLevelSnapshot(
                Rms: Math.Clamp(rms, 0, 1),
                Peak: Math.Clamp(_peakSinceLastLevel, 0, 1),
                BytesSent: _bytesSinceLastLevel,
                SampleRate: format.SampleRate,
                Channels: format.Channels));
            _lastLevelAt = now;
            _bytesSinceLastLevel = 0;
            _sumSquaresSinceLastLevel = 0;
            _samplesSinceLastLevel = 0;
            _peakSinceLastLevel = 0;
        }
    }
}

internal sealed record AudioLevelSnapshot(double Rms, double Peak, long BytesSent, int SampleRate, int Channels);
