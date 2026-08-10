namespace GitHubDeliveryAuthority;

/// <summary>
/// Shared GitHub-light visual language for the authority host dialogs:
/// white surface, #D0D7DE borders, Segoe UI text, Consolas details,
/// and a #0969DA primary action.
/// </summary>
internal static class GitHubTheme
{
    public static readonly Color Canvas = Color.FromArgb(0xFF, 0xFF, 0xFF);
    public static readonly Color SubtleBg = Color.FromArgb(0xF6, 0xF8, 0xFA);
    public static readonly Color Border = Color.FromArgb(0xD0, 0xD7, 0xDE);
    public static readonly Color TextPrimary = Color.FromArgb(0x1F, 0x23, 0x28);
    public static readonly Color TextSecondary = Color.FromArgb(0x57, 0x60, 0x6A);
    public static readonly Color Accent = Color.FromArgb(0x09, 0x69, 0xDA);
    public static readonly Color AccentHover = Color.FromArgb(0x0A, 0x6E, 0xD1);

    public static Font UiFont(float size, FontStyle style = FontStyle.Regular)
        => new("Segoe UI", size, style, GraphicsUnit.Point);

    public static Font MonoFont(float size, FontStyle style = FontStyle.Regular)
        => new("Consolas", size, style, GraphicsUnit.Point);

    public static void StyleButton(Button button, bool primary = false)
    {
        button.FlatStyle = FlatStyle.Flat;
        button.FlatAppearance.BorderSize = 1;
        button.Font = UiFont(9.75f);
        button.Padding = new Padding(14, 5, 14, 5);
        button.AutoSize = true;
        button.Cursor = Cursors.Hand;
        if (primary)
        {
            button.BackColor = Accent;
            button.ForeColor = Color.White;
            button.FlatAppearance.BorderColor = Accent;
            button.FlatAppearance.MouseOverBackColor = AccentHover;
            button.FlatAppearance.MouseDownBackColor = AccentHover;
        }
        else
        {
            button.BackColor = Canvas;
            button.ForeColor = TextPrimary;
            button.FlatAppearance.BorderColor = Border;
            button.FlatAppearance.MouseOverBackColor = SubtleBg;
            button.FlatAppearance.MouseDownBackColor = SubtleBg;
        }
    }

    public static void StyleTextBox(TextBox box, bool monospace = false)
    {
        box.BorderStyle = BorderStyle.FixedSingle;
        box.BackColor = Canvas;
        box.ForeColor = TextPrimary;
        if (monospace) box.Font = MonoFont(10f);
    }

    public static void AddBorder(Control control, Color color)
    {
        control.Paint += (_, e) =>
        {
            using var pen = new Pen(color);
            var rect = control.ClientRectangle;
            rect.Width -= 1;
            rect.Height -= 1;
            e.Graphics.DrawRectangle(pen, rect);
        };
    }

    /// <summary>
    /// Shared header row: shield mark, app name, and a GitHub-style status
    /// pill on the right.
    /// </summary>
    public static TableLayoutPanel BuildHeader(string pillLabel)
    {
        var header = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 3,
            RowCount = 1,
            Margin = new Padding(0),
            BackColor = Canvas,
        };
        header.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        header.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        header.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        header.Controls.Add(new ShieldMark { Margin = new Padding(0, 2, 10, 2) }, 0, 0);
        header.Controls.Add(new Label
        {
            Text = "GitHub Delivery Authority",
            Font = UiFont(11f, FontStyle.Bold),
            ForeColor = TextPrimary,
            AutoSize = true,
            Dock = DockStyle.Fill,
            TextAlign = ContentAlignment.MiddleLeft,
            Margin = new Padding(0),
        }, 1, 0);
        header.Controls.Add(new StatusPill(pillLabel) { Margin = new Padding(12, 1, 0, 1) }, 2, 0);
        return header;
    }
}
