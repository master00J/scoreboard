// WASAPI-loopback via NAudio: s16le stereo 48 kHz naar named pipe, of piekregels in --meter.
// args: <pipeName> <friendlyDeviceName>
//    of: --meter <friendlyDeviceName>
//    of: --list
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Pipes;
using System.Reflection;
using System.Threading;
using NAudio.CoreAudioApi;
using NAudio.Wave;

internal static class Program
{
    private const int SampleRate = 48000;
    private const int MonitorLatencyMs = 20;
    private const int MonitorRingMs = 30;
    private static readonly object Gate = new object();

    private static int Main(string[] args)
    {
        if (args.Length >= 1 && args[0] == "--list")
        {
            foreach (var item in RenderDevices()) Console.WriteLine(item.FriendlyName);
            return 0;
        }
        if (args.Length >= 3 && args[0] == "--monitor")
        {
            var sources = new string[args.Length - 2];
            Array.Copy(args, 2, sources, 0, sources.Length);
            try
            {
                return RunMonitor(args[1], sources);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("fail " + ex.Message);
                return 1;
            }
        }
        var meter = args.Length >= 2 && args[0] == "--meter";
        if (!meter && args.Length < 2) return 2;
        var want = args[1];
        var device = FindRenderDevice(want);
        if (device == null)
        {
            Console.Error.WriteLine("not-found " + want);
            return 3;
        }
        try
        {
            if (meter) return RunMeter(device);
            return RunPipe(args[0].Replace(@"\\.\pipe\", ""), device);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("fail " + ex.Message);
            return 1;
        }
    }

    private static MMDevice[] RenderDevices()
    {
        var enumerator = new MMDeviceEnumerator();
        var collection = enumerator.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active);
        var list = new MMDevice[collection.Count];
        for (var i = 0; i < collection.Count; i++) list[i] = collection[i];
        return list;
    }

    private static MMDevice FindRenderDevice(string want)
    {
        var needle = want.Trim();
        MMDevice fallback = null;
        foreach (var device in RenderDevices())
        {
            var name = device.FriendlyName ?? "";
            if (string.Equals(name, needle, StringComparison.OrdinalIgnoreCase)) return device;
            if (fallback == null && string.Equals(name, needle, StringComparison.OrdinalIgnoreCase) == false)
            {
                if (name.StartsWith(needle, StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(ShortName(name), needle, StringComparison.OrdinalIgnoreCase))
                    fallback = device;
            }
        }
        return fallback;
    }

    private static string ShortName(string friendly)
    {
        var open = friendly.LastIndexOf(" (");
        return open > 0 ? friendly.Substring(0, open) : friendly;
    }

    private static int RunMeter(MMDevice device)
    {
        using (var capture = new WasapiLoopbackCapture(device))
        {
            capture.DataAvailable += delegate(object sender, WaveInEventArgs e)
            {
                var peak = Peak(e.Buffer, e.BytesRecorded, capture.WaveFormat);
                Console.WriteLine(peak.ToString("0.000", CultureInfo.InvariantCulture));
            };
            capture.StartRecording();
            var quit = new ManualResetEvent(false);
            quit.WaitOne();
        }
        return 0;
    }

    private static int RunPipe(string pipeName, MMDevice device)
    {
        using (var pipe = new NamedPipeServerStream(pipeName, PipeDirection.Out, 1, PipeTransmissionMode.Byte))
        {
            Console.Error.WriteLine("ready");
            Console.Error.Flush();
            pipe.WaitForConnection();
            using (var capture = new WasapiLoopbackCapture(device))
            {
                var silence = new byte[SampleRate * 4 / 50];
                var lastWrite = DateTime.UtcNow;
                capture.DataAvailable += delegate(object sender, WaveInEventArgs e)
                {
                    var pcm = ToS16Stereo(e.Buffer, e.BytesRecorded, capture.WaveFormat);
                    lock (Gate)
                    {
                        if (pcm.Length > 0) pipe.Write(pcm, 0, pcm.Length);
                        lastWrite = DateTime.UtcNow;
                    }
                };
                capture.StartRecording();
                while (pipe.IsConnected)
                {
                    Thread.Sleep(10);
                    lock (Gate)
                    {
                        if ((DateTime.UtcNow - lastWrite).TotalMilliseconds > 25)
                        {
                            pipe.Write(silence, 0, silence.Length);
                            lastWrite = DateTime.UtcNow;
                        }
                    }
                }
            }
        }
        return 0;
    }

    private static float Peak(byte[] buffer, int bytes, WaveFormat format)
    {
        var peak = 0f;
        if (format.Encoding == WaveFormatEncoding.IeeeFloat)
        {
            for (var i = 0; i + 4 <= bytes; i += 4)
            {
                var v = BitConverter.ToSingle(buffer, i);
                if (v < 0) v = -v;
                if (v > peak) peak = v;
            }
            return peak > 1f ? 1f : peak;
        }
        for (var i = 0; i + 2 <= bytes; i += 2)
        {
            var v = Math.Abs(BitConverter.ToInt16(buffer, i)) / 32768f;
            if (v > peak) peak = v;
        }
        return peak;
    }

    private static byte[] ToS16Stereo(byte[] buffer, int bytes, WaveFormat format)
    {
        var ch = format.Channels < 1 ? 1 : format.Channels;
        var srcRate = format.SampleRate < 1 ? SampleRate : format.SampleRate;
        if (format.Encoding == WaveFormatEncoding.IeeeFloat)
        {
            var frames = bytes / (4 * ch);
            return ConvertFrames(frames, ch, srcRate, true, buffer);
        }
        var pcmFrames = bytes / (2 * ch);
        return ConvertFrames(pcmFrames, ch, srcRate, false, buffer);
    }

    private static byte[] ConvertFrames(int frames, int ch, int srcRate, bool ieee, byte[] buffer)
    {
        if (frames <= 0) return new byte[0];
        var outFrames = srcRate == SampleRate ? frames : (int)((long)frames * SampleRate / srcRate);
        if (outFrames < 1) outFrames = 1;
        var dest = new byte[outFrames * 4];
        for (var of = 0; of < outFrames; of++)
        {
            var sf = srcRate == SampleRate ? of : (int)((long)of * srcRate / SampleRate);
            if (sf >= frames) sf = frames - 1;
            float left;
            float right;
            if (ieee)
            {
                left = BitConverter.ToSingle(buffer, (sf * ch) * 4);
                right = ch > 1 ? BitConverter.ToSingle(buffer, (sf * ch + 1) * 4) : left;
            }
            else
            {
                left = BitConverter.ToInt16(buffer, (sf * ch) * 2) / 32768f;
                right = ch > 1 ? BitConverter.ToInt16(buffer, (sf * ch + 1) * 2) / 32768f : left;
            }
            WriteS16(dest, of * 4, left);
            WriteS16(dest, of * 4 + 2, right);
        }
        return dest;
    }

    private static void WriteS16(byte[] dest, int offset, float sample)
    {
        if (sample > 1f) sample = 1f;
        if (sample < -1f) sample = -1f;
        var v = (short)(sample * 32767f);
        dest[offset] = (byte)(v & 0xff);
        dest[offset + 1] = (byte)((v >> 8) & 0xff);
    }

    private static MMDevice[] CaptureDevices()
    {
        var enumerator = new MMDeviceEnumerator();
        var collection = enumerator.EnumerateAudioEndPoints(DataFlow.Capture, DeviceState.Active);
        var list = new MMDevice[collection.Count];
        for (var i = 0; i < collection.Count; i++) list[i] = collection[i];
        return list;
    }

    private static MMDevice FindCaptureDevice(string want)
    {
        var needle = want.Trim();
        MMDevice fallback = null;
        foreach (var device in CaptureDevices())
        {
            var name = device.FriendlyName ?? "";
            if (string.Equals(name, needle, StringComparison.OrdinalIgnoreCase)) return device;
            if (fallback == null &&
                (name.StartsWith(needle, StringComparison.OrdinalIgnoreCase) ||
                 string.Equals(ShortName(name), needle, StringComparison.OrdinalIgnoreCase)))
                fallback = device;
        }
        return fallback;
    }

    private static int RunMonitor(string outputName, string[] sourceNames)
    {
        MMDevice output;
        if (outputName == "." || outputName.Trim().Length == 0)
            output = new MMDeviceEnumerator().GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
        else
            output = FindRenderDevice(outputName);
        if (output == null)
        {
            Console.Error.WriteLine("not-found-out " + outputName);
            return 3;
        }
        var sources = new List<MonitorSource>();
        for (var i = 0; i < sourceNames.Length; i++)
        {
            var src = OpenMonitorSource(sourceNames[i]);
            if (src != null) sources.Add(src);
        }
        if (sources.Count == 0)
        {
            Console.Error.WriteLine("no-sources");
            return 3;
        }
        var mix = new MixProvider(sources);
        var reader = new Thread(delegate()
        {
            string line;
            while ((line = Console.In.ReadLine()) != null) mix.SetGains(line);
        });
        reader.IsBackground = true;
        reader.Start();
        using (var waveOut = new WasapiOut(output, AudioClientShareMode.Shared, true, MonitorLatencyMs))
        {
            waveOut.Init(mix);
            waveOut.Play();
            Console.Error.WriteLine("ready");
            Console.Error.Flush();
            var quit = new ManualResetEvent(false);
            quit.WaitOne();
        }
        return 0;
    }

    private static MonitorSource OpenMonitorSource(string raw)
    {
        var loopback = raw.StartsWith("wasapi:", StringComparison.OrdinalIgnoreCase);
        var name = loopback ? raw.Substring(7) : raw;
        MMDevice device = loopback ? FindRenderDevice(name) : FindCaptureDevice(name);
        if (device == null && !loopback) device = FindRenderDevice(name);
        if (device == null)
        {
            Console.Error.WriteLine("skip " + raw);
            return null;
        }
        WasapiCapture capture = loopback
            ? (WasapiCapture)new WasapiLoopbackCapture(device)
            : new WasapiCapture(device, true, MonitorLatencyMs);
        SetCaptureBufferMs(capture, MonitorLatencyMs);
        var source = new MonitorSource(capture);
        capture.DataAvailable += source.OnData;
        capture.StartRecording();
        return source;
    }

    private static void SetCaptureBufferMs(WasapiCapture capture, int ms)
    {
        var field = typeof(WasapiCapture).GetField(
            "audioBufferMillisecondsLength",
            BindingFlags.Instance | BindingFlags.NonPublic);
        if (field != null) field.SetValue(capture, ms);
    }

    private sealed class MonitorSource
    {
        private readonly object _gate = new object();
        private readonly float[] _ring = new float[SampleRate * 2 * MonitorRingMs / 1000];
        private int _write;
        private int _read;
        private int _count;
        public float Gain;

        public MonitorSource(WasapiCapture capture)
        {
            Capture = capture;
            Gain = 0f;
        }

        public WasapiCapture Capture;

        public void OnData(object sender, WaveInEventArgs e)
        {
            var stereo = ToFloatStereo(e.Buffer, e.BytesRecorded, Capture.WaveFormat);
            if (stereo.Length == 0) return;
            lock (_gate)
            {
                for (var i = 0; i < stereo.Length; i++)
                {
                    if (_count >= _ring.Length)
                    {
                        _read = (_read + 2) % _ring.Length;
                        _count -= 2;
                    }
                    _ring[_write] = stereo[i];
                    _write = (_write + 1) % _ring.Length;
                    _count++;
                }
            }
        }

        public int ReadMix(float[] dest, int offset, int frames, float gain)
        {
            if (gain <= 0.0001f) return 0;
            lock (_gate)
            {
                var available = _count / 2;
                var n = available < frames ? available : frames;
                for (var i = 0; i < n; i++)
                {
                    dest[offset + i * 2] += _ring[_read] * gain;
                    dest[offset + i * 2 + 1] += _ring[(_read + 1) % _ring.Length] * gain;
                    _read = (_read + 2) % _ring.Length;
                    _count -= 2;
                }
                return n;
            }
        }
    }

    private sealed class MixProvider : IWaveProvider
    {
        private readonly List<MonitorSource> _sources;
        private readonly float[] _gains;
        private float[] _mix = new float[0];
        private readonly WaveFormat _format = WaveFormat.CreateIeeeFloatWaveFormat(SampleRate, 2);

        public MixProvider(List<MonitorSource> sources)
        {
            _sources = sources;
            _gains = new float[sources.Count];
        }

        public WaveFormat WaveFormat { get { return _format; } }

        public void SetGains(string line)
        {
            var parts = line.Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries);
            var n = parts.Length < _gains.Length ? parts.Length : _gains.Length;
            for (var i = 0; i < n; i++)
            {
                float g;
                if (float.TryParse(parts[i].Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out g))
                {
                    if (g < 0f) g = 0f;
                    if (g > 2f) g = 2f;
                    _gains[i] = g;
                    _sources[i].Gain = g;
                }
            }
        }

        public int Read(byte[] buffer, int offset, int count)
        {
            var frames = count / 8;
            if (frames < 1) return 0;
            var needed = frames * 2;
            if (_mix.Length < needed) _mix = new float[needed];
            Array.Clear(_mix, 0, needed);
            for (var i = 0; i < _sources.Count; i++)
                _sources[i].ReadMix(_mix, 0, frames, _gains[i]);
            for (var i = 0; i < needed; i++)
            {
                var v = _mix[i];
                if (v > 1f) v = 1f;
                if (v < -1f) v = -1f;
                var bits = BitConverter.GetBytes(v);
                Buffer.BlockCopy(bits, 0, buffer, offset + i * 4, 4);
            }
            return frames * 8;
        }
    }

    private static float[] ToFloatStereo(byte[] buffer, int bytes, WaveFormat format)
    {
        var ch = format.Channels < 1 ? 1 : format.Channels;
        var srcRate = format.SampleRate < 1 ? SampleRate : format.SampleRate;
        var ieee = format.Encoding == WaveFormatEncoding.IeeeFloat;
        var frames = ieee ? bytes / (4 * ch) : bytes / (2 * ch);
        if (frames <= 0) return new float[0];
        var outFrames = srcRate == SampleRate ? frames : (int)((long)frames * SampleRate / srcRate);
        if (outFrames < 1) outFrames = 1;
        var dest = new float[outFrames * 2];
        for (var of = 0; of < outFrames; of++)
        {
            var sf = srcRate == SampleRate ? of : (int)((long)of * srcRate / SampleRate);
            if (sf >= frames) sf = frames - 1;
            float left;
            float right;
            if (ieee)
            {
                left = BitConverter.ToSingle(buffer, (sf * ch) * 4);
                right = ch > 1 ? BitConverter.ToSingle(buffer, (sf * ch + 1) * 4) : left;
            }
            else
            {
                left = BitConverter.ToInt16(buffer, (sf * ch) * 2) / 32768f;
                right = ch > 1 ? BitConverter.ToInt16(buffer, (sf * ch + 1) * 2) / 32768f : left;
            }
            dest[of * 2] = left;
            dest[of * 2 + 1] = right;
        }
        return dest;
    }
}
