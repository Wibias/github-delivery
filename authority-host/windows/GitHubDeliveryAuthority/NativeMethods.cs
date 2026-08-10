using System.Runtime.InteropServices;

namespace GitHubDeliveryAuthority;

internal static class NativeMethods
{
    [StructLayout(LayoutKind.Sequential)]
    internal struct FlashWindowInfo
    {
        public uint cbSize;
        public IntPtr hwnd;
        public FlashWindowFlags dwFlags;
        public uint uCount;
        public uint dwTimeout;
    }

    [Flags]
    internal enum FlashWindowFlags : uint
    {
        FLASHW_STOP = 0,
        FLASHW_CAPTION = 0x00000001,
        FLASHW_TRAY = 0x00000002,
        FLASHW_ALL = 0x00000003,
        FLASHW_TIMER = 0x00000004,
        FLASHW_TIMERNOFG = 0x0000000C,
    }

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool FlashWindowEx(ref FlashWindowInfo pwfi);
}
