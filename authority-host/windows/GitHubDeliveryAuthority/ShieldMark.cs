using System.Drawing.Drawing2D;

namespace GitHubDeliveryAuthority;

/// <summary>Small drawn shield-with-check mark in the GitHub accent color.</summary>
internal sealed class ShieldMark : Control
{
    public ShieldMark()
    {
        SetStyle(ControlStyles.SupportsTransparentBackColor | ControlStyles.OptimizedDoubleBuffer, true);
        BackColor = Color.Transparent;
        Size = new Size(24, 24);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        var w = Width - 2f;
        var h = Height - 2f;
        var body = new[]
        {
            new PointF(1f, 1f),
            new PointF(w - 1f, 1f),
            new PointF(w - 1f, h * 0.62f),
            new PointF(w / 2f, h - 1f),
            new PointF(1f, h * 0.62f),
        };
        using var fill = new SolidBrush(Color.FromArgb(20, GitHubTheme.Accent));
        using var pen = new Pen(GitHubTheme.Accent, 1.8f);
        g.FillPolygon(fill, body);
        g.DrawPolygon(pen, body);
        using var check = new Pen(GitHubTheme.Accent, 1.8f)
        {
            StartCap = LineCap.Round,
            EndCap = LineCap.Round,
        };
        g.DrawLines(check, new[]
        {
            new PointF(w * 0.30f, h * 0.55f),
            new PointF(w * 0.46f, h * 0.68f),
            new PointF(w * 0.72f, h * 0.40f),
        });
    }
}
