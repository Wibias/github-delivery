param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Inspect', 'Close')]
  [string]$Mode,

  [string]$Target,

  [int]$ProcessId = 0,

  [string]$ExpectedStartTimeUtc
)

$ErrorActionPreference = 'Stop'

if ($Mode -eq 'Close') {
  if ($ProcessId -le 0) {
    throw 'ProcessId is required for Close mode.'
  }
  if ([string]::IsNullOrWhiteSpace($ExpectedStartTimeUtc)) {
    @{ requested = $false; reason = 'process_identity_missing' } | ConvertTo-Json -Compress
    exit 0
  }

  try {
    $process = [System.Diagnostics.Process]::GetProcessById($ProcessId)
  } catch {
    @{ requested = $false; reason = 'process_not_found' } | ConvertTo-Json -Compress
    exit 0
  }

  if ($process.Id -eq $PID) {
    @{ requested = $false; reason = 'current_process' } | ConvertTo-Json -Compress
    exit 0
  }

  try {
    $actualStartTimeUtc = $process.StartTime.ToUniversalTime().ToString('O')
  } catch {
    @{ requested = $false; reason = 'process_identity_unavailable' } | ConvertTo-Json -Compress
    exit 0
  }
  if (-not [string]::Equals($actualStartTimeUtc, $ExpectedStartTimeUtc, [System.StringComparison]::Ordinal)) {
    @{ requested = $false; reason = 'process_identity_changed' } | ConvertTo-Json -Compress
    exit 0
  }

  $requested = $process.CloseMainWindow()
  @{ requested = [bool]$requested; reason = $(if ($requested) { $null } else { 'no_main_window' }) } | ConvertTo-Json -Compress
  exit 0
}

if ([string]::IsNullOrWhiteSpace($Target)) {
  throw 'Target is required for Inspect mode.'
}

$source = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public sealed class GitHubDeliveryLockRecord
{
    public int pid { get; set; }
    public string name { get; set; }
    public string startTimeUtc { get; set; }
    public string[] paths { get; set; }
}

public static class GitHubDeliveryHandleInspector
{
    private const int SystemExtendedHandleInformation = 64;
    private const int STATUS_INFO_LENGTH_MISMATCH = unchecked((int)0xC0000004);
    private const uint PROCESS_DUP_HANDLE = 0x0040;
    private const uint DUPLICATE_SAME_ACCESS = 0x00000002;
    private const uint FILE_TYPE_DISK = 0x0001;

    [DllImport("ntdll.dll")]
    private static extern int NtQuerySystemInformation(
        int SystemInformationClass,
        IntPtr SystemInformation,
        int SystemInformationLength,
        out int ReturnLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, int dwProcessId);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DuplicateHandle(
        IntPtr hSourceProcessHandle,
        IntPtr hSourceHandle,
        IntPtr hTargetProcessHandle,
        out IntPtr lpTargetHandle,
        uint dwDesiredAccess,
        [MarshalAs(UnmanagedType.Bool)] bool bInheritHandle,
        uint dwOptions);

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentProcess();

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr hObject);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint GetFileType(IntPtr hFile);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFinalPathNameByHandle(
        IntPtr hFile,
        StringBuilder lpszFilePath,
        uint cchFilePath,
        uint dwFlags);

    private static string NormalizePath(string value)
    {
        if (String.IsNullOrWhiteSpace(value)) return null;
        string path = value;
        if (path.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase))
        {
            path = @"\\" + path.Substring(8);
        }
        else if (path.StartsWith(@"\\?\", StringComparison.OrdinalIgnoreCase))
        {
            path = path.Substring(4);
        }
        return path.TrimEnd('\\');
    }

    private static bool IsInside(string path, string root)
    {
        if (String.Equals(path, root, StringComparison.OrdinalIgnoreCase)) return true;
        return path.StartsWith(root + @"\", StringComparison.OrdinalIgnoreCase);
    }

    private static string PathForHandle(IntPtr handle)
    {
        if (GetFileType(handle) != FILE_TYPE_DISK) return null;
        StringBuilder buffer = new StringBuilder(1024);
        uint length = GetFinalPathNameByHandle(handle, buffer, (uint)buffer.Capacity, 0);
        if (length == 0) return null;
        if (length >= buffer.Capacity)
        {
            buffer = new StringBuilder((int)length + 1);
            length = GetFinalPathNameByHandle(handle, buffer, (uint)buffer.Capacity, 0);
            if (length == 0 || length >= buffer.Capacity) return null;
        }
        return NormalizePath(buffer.ToString());
    }

    private static IntPtr QueryHandleTable(out long count)
    {
        int size = 1024 * 1024;
        while (true)
        {
            IntPtr buffer = Marshal.AllocHGlobal(size);
            int required;
            int status = NtQuerySystemInformation(SystemExtendedHandleInformation, buffer, size, out required);
            if (status == 0)
            {
                count = Marshal.ReadIntPtr(buffer).ToInt64();
                return buffer;
            }
            Marshal.FreeHGlobal(buffer);
            if (status != STATUS_INFO_LENGTH_MISMATCH)
            {
                throw new InvalidOperationException("NtQuerySystemInformation failed: 0x" + status.ToString("X8"));
            }
            size = Math.Max(size * 2, required + 65536);
            if (size > 256 * 1024 * 1024)
            {
                throw new InvalidOperationException("System handle table is unexpectedly large.");
            }
        }
    }

    public static GitHubDeliveryLockRecord[] Inspect(string target)
    {
        string root = NormalizePath(System.IO.Path.GetFullPath(target));
        Dictionary<int, HashSet<string>> matches = new Dictionary<int, HashSet<string>>();
        Dictionary<int, IntPtr> processHandles = new Dictionary<int, IntPtr>();
        IntPtr table = IntPtr.Zero;
        long count = 0;

        try
        {
            table = QueryHandleTable(out count);
            int pointerSize = IntPtr.Size;
            int entrySize = pointerSize == 8 ? 40 : 28;
            long headerSize = pointerSize * 2;
            IntPtr currentProcess = GetCurrentProcess();

            for (long index = 0; index < count; index++)
            {
                long offset = headerSize + (index * entrySize);
                IntPtr entry = new IntPtr(table.ToInt64() + offset);
                long rawPid = Marshal.ReadIntPtr(entry, pointerSize).ToInt64();
                if (rawPid <= 0 || rawPid > Int32.MaxValue) continue;
                int pid = (int)rawPid;

                IntPtr sourceProcess;
                if (!processHandles.TryGetValue(pid, out sourceProcess))
                {
                    sourceProcess = OpenProcess(PROCESS_DUP_HANDLE, false, pid);
                    processHandles[pid] = sourceProcess;
                }
                if (sourceProcess == IntPtr.Zero) continue;

                IntPtr sourceHandle = Marshal.ReadIntPtr(entry, pointerSize * 2);
                IntPtr duplicate;
                if (!DuplicateHandle(sourceProcess, sourceHandle, currentProcess, out duplicate, 0, false, DUPLICATE_SAME_ACCESS))
                {
                    continue;
                }

                try
                {
                    string path = PathForHandle(duplicate);
                    if (path == null || !IsInside(path, root)) continue;
                    HashSet<string> paths;
                    if (!matches.TryGetValue(pid, out paths))
                    {
                        paths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                        matches[pid] = paths;
                    }
                    paths.Add(path);
                }
                finally
                {
                    CloseHandle(duplicate);
                }
            }
        }
        finally
        {
            foreach (KeyValuePair<int, IntPtr> pair in processHandles)
            {
                if (pair.Value != IntPtr.Zero) CloseHandle(pair.Value);
            }
            if (table != IntPtr.Zero) Marshal.FreeHGlobal(table);
        }

        List<GitHubDeliveryLockRecord> result = new List<GitHubDeliveryLockRecord>();
        foreach (KeyValuePair<int, HashSet<string>> pair in matches)
        {
            string processName;
            string startTimeUtc = null;
            try
            {
                Process process = Process.GetProcessById(pair.Key);
                processName = process.ProcessName;
                startTimeUtc = process.StartTime.ToUniversalTime().ToString("O");
                if (!processName.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) processName += ".exe";
            }
            catch
            {
                processName = "PID " + pair.Key.ToString();
            }
            string[] paths = new string[pair.Value.Count];
            pair.Value.CopyTo(paths);
            Array.Sort(paths, StringComparer.OrdinalIgnoreCase);
            result.Add(new GitHubDeliveryLockRecord { pid = pair.Key, name = processName, startTimeUtc = startTimeUtc, paths = paths });
        }
        result.Sort(delegate(GitHubDeliveryLockRecord left, GitHubDeliveryLockRecord right) { return left.pid.CompareTo(right.pid); });
        return result.ToArray();
    }
}
'@

if (-not ('GitHubDeliveryHandleInspector' -as [type])) {
  Add-Type -TypeDefinition $source -Language CSharp
}

$records = [GitHubDeliveryHandleInspector]::Inspect([System.IO.Path]::GetFullPath($Target))
if ($null -eq $records -or $records.Count -eq 0) {
  '[]'
} else {
  @($records) | ConvertTo-Json -Depth 5 -Compress
}
