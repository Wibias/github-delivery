using System.Drawing.Drawing2D;

namespace GitHubDeliveryAuthority;

/// <summary>Small rounded GitHub-style status pill (soft gray).</summary>
internal sealed class StatusPill : Control
{
    private readonly string _label;
    private readonly Color _background;
    private readonly Color _foreground;

    public StatusPill(string label, Color? background = null, Color? foreground = null)
    {
        _label = label;
        _background = background ?? GitHubTheme.SubtleBg;
        _foreground = foreground ?? GitHubTheme.TextSecondary;
        SetStyle(ControlStyles.SupportsTransparentBackColor | ControlStyles.OptimizedDoubleBuffer, true);
        BackColor = Color.Transparent;
        Font = GitHubTheme.UiFont(9f, FontStyle.Bold);
        var width = TextRenderer.MeasureText(label, Font).Width + 22;
        Size = new Size(width, 24);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        var rect = new RectangleF(0, 0, Width - 1, Height - 1);
        using var path = RoundedRect(rect, 12f);
        using var fill = new SolidBrush(_background);
        using var border = new Pen(GitHubTheme.Border);
        using var text = new SolidBrush(_foreground);
        using var format = new StringFormat
        {
            Alignment = StringAlignment.Center,
            LineAlignment = StringAlignment.Center,
        };
        g.FillPath(fill, path);
        g.DrawPath(border, path);
        g.DrawString(_label, Font, text, rect, format);
    }

    private static GraphicsPath RoundedRect(RectangleF rect, float radius)
    {
        var path = new GraphicsPath();
        var d = radius * 2f;
        path.AddArc(rect.X, rect.Y, d, d, 180, 90);
        path.AddArc(rect.Right - d, rect.Y, d, d, 270, 90);
        path.AddArc(rect.Right - d, rect.Bottom - d, d, d, 0, 90);
        path.AddArc(rect.X, rect.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }
}
