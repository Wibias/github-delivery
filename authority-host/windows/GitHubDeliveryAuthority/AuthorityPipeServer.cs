using System.Buffers.Binary;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace GitHubDeliveryAuthority;

internal sealed class AuthorityPipeServer : IAsyncDisposable
{
    public const string Protocol = "github-delivery-authority/1";
    public const string DefaultPipeName = "github-delivery-authority-v1";
    private const int MaxFrameBytes = 256 * 1024;
    private const int MaxConcurrentClients = 8;
    private readonly string _pipeName;
    private readonly AuthorityService _service;
    private readonly CancellationTokenSource _stop = new();
    private Task? _loop;
    private readonly SemaphoreSlim _authorizeGate = new(1, 1);

    public AuthorityPipeServer(AuthorityService service, string pipeName = DefaultPipeName)
    {
        if (string.IsNullOrWhiteSpace(pipeName) || pipeName.Length > 128 || pipeName.Any(ch => !(char.IsAsciiLetterOrDigit(ch) || ch is '.' or '_' or '-')))
        {
            throw new AuthorityException("authority_pipe_name_invalid");
        }
        _service = service;
        _pipeName = pipeName;
    }

    public void Start()
    {
        if (_loop is not null) return;
        _loop = Task.Run(() => ListenAsync(_stop.Token));
    }

    private async Task ListenAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            await using var pipe = new NamedPipeServerStream(
                _pipeName,
                PipeDirection.InOut,
                MaxConcurrentClients,
                PipeTransmissionMode.Byte,
                PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly,
                4096,
                4096);
            try
            {
                await pipe.WaitForConnectionAsync(cancellationToken).ConfigureAwait(false);
                if (!IsSameSession(pipe))
                {
                    await WriteResponseAsync(pipe, "unknown", false, null, "cross_session_denied", cancellationToken).ConfigureAwait(false);
                    continue;
                }
                await HandleConnectionAsync(pipe, cancellationToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                return;
            }
            catch
            {
            }
        }
    }

    private async Task HandleConnectionAsync(NamedPipeServerStream pipe, CancellationToken cancellationToken)
    {
        string id = "unknown";
        try
        {
            var request = await ReadFrameAsync(pipe, cancellationToken).ConfigureAwait(false);
            if (!request.TryGetProperty("protocol", out var protocol) || protocol.GetString() != Protocol) throw new AuthorityException("authority_protocol_mismatch");
            id = RequiredString(request, "id");
            var method = RequiredString(request, "method");
            var parameters = request.TryGetProperty("params", out var paramsValue) && paramsValue.ValueKind == JsonValueKind.Object
                ? paramsValue
                : throw new AuthorityException("authority_params_invalid");

            object result = method switch
            {
                "status" => _service.Status(),
                "authorizeBatch" => await RunAuthorizeBatchAsync(parameters, cancellationToken).ConfigureAwait(false),
                "redeemGrant" => _service.RedeemGrant(parameters),
                _ => throw new AuthorityException("authority_method_not_allowed"),
            };
            await WriteResponseAsync(pipe, id, true, result, null, cancellationToken).ConfigureAwait(false);
        }
        catch (AuthorityException error)
        {
            await WriteResponseAsync(pipe, id, false, null, error.Code, cancellationToken).ConfigureAwait(false);
        }
        catch
        {
            await WriteResponseAsync(pipe, id, false, null, "authority_internal_error", cancellationToken).ConfigureAwait(false);
        }
    }

    private async Task<object> RunAuthorizeBatchAsync(JsonElement parameters, CancellationToken cancellationToken)
        => await RunSerializedAuthorizeAsync(
            () => _service.AuthorizeBatchAsync(parameters),
            cancellationToken).ConfigureAwait(false);

    internal async Task<object> RunSerializedAuthorizeAsync(
        Func<Task<object>> operation,
        CancellationToken cancellationToken = default)
    {
        // Only one approval prompt can be shown at a time. A concurrent caller
        // gets a distinct busy error instead of blocking on the UI thread or
        // silently waiting behind an unseen Windows Hello prompt.
        if (!await _authorizeGate.WaitAsync(0, cancellationToken).ConfigureAwait(false))
        {
            throw new AuthorityException("authority_host_busy");
        }
        try
        {
            return await operation().ConfigureAwait(false);
        }
        finally
        {
            _authorizeGate.Release();
        }
    }

    private static async Task<JsonElement> ReadFrameAsync(Stream stream, CancellationToken cancellationToken)
    {
        var header = new byte[4];
        await ReadExactAsync(stream, header, cancellationToken).ConfigureAwait(false);
        var length = BinaryPrimitives.ReadUInt32LittleEndian(header);
        if (length is 0 or > MaxFrameBytes) throw new AuthorityException("authority_frame_too_large");
        var payload = new byte[checked((int)length)];
        await ReadExactAsync(stream, payload, cancellationToken).ConfigureAwait(false);
        try
        {
            using var document = JsonDocument.Parse(payload);
            if (document.RootElement.ValueKind != JsonValueKind.Object) throw new AuthorityException("authority_frame_json_invalid");
            return document.RootElement.Clone();
        }
        catch (JsonException)
        {
            throw new AuthorityException("authority_frame_json_invalid");
        }
    }

    private static async Task ReadExactAsync(Stream stream, Memory<byte> buffer, CancellationToken cancellationToken)
    {
        var offset = 0;
        while (offset < buffer.Length)
        {
            var count = await stream.ReadAsync(buffer[offset..], cancellationToken).ConfigureAwait(false);
            if (count == 0) throw new AuthorityException("authority_pipe_closed");
            offset += count;
        }
    }

    private static async Task WriteResponseAsync(Stream stream, string id, bool ok, object? result, string? errorCode, CancellationToken cancellationToken)
    {
        object response = ok
            ? new { protocol = Protocol, id, ok = true, result }
            : new { protocol = Protocol, id, ok = false, error = new { code = errorCode, message = "Authority request denied." } };
        var payload = JsonSerializer.SerializeToUtf8Bytes(response);
        if (payload.Length > MaxFrameBytes) throw new AuthorityException("authority_frame_too_large");
        var header = new byte[4];
        BinaryPrimitives.WriteUInt32LittleEndian(header, checked((uint)payload.Length));
        await stream.WriteAsync(header, cancellationToken).ConfigureAwait(false);
        await stream.WriteAsync(payload, cancellationToken).ConfigureAwait(false);
        await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
    }

    private static bool IsSameSession(NamedPipeServerStream pipe)
    {
        if (!GetNamedPipeClientSessionId(pipe.SafePipeHandle.DangerousGetHandle(), out var clientSession)) return false;
        return ProcessIdToSessionId((uint)Environment.ProcessId, out var serverSession) && clientSession == serverSession;
    }

    private static string RequiredString(JsonElement element, string name)
    {
        if (!element.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(value.GetString()))
        {
            throw new AuthorityException($"authority_{name}_required");
        }
        return value.GetString()!;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetNamedPipeClientSessionId(IntPtr pipe, out uint clientSessionId);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ProcessIdToSessionId(uint processId, out uint sessionId);

    public async ValueTask DisposeAsync()
    {
        _stop.Cancel();
        if (_loop is not null)
        {
            try { await _loop.ConfigureAwait(false); } catch (OperationCanceledException) { }
        }
        _stop.Dispose();
        _authorizeGate.Dispose();
    }
}
