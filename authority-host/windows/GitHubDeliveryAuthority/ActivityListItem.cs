using System.Globalization;

namespace GitHubDeliveryAuthority;

internal abstract record ActivityListItem;

internal sealed record ActivityDaySeparatorItem(string Label) : ActivityListItem
{
    public override string ToString() => Label;
}

internal sealed record ActivityEventItem(
    string Time,
    string Repository,
    string Action,
    string Status,
    string Actor,
    string Branch = "") : ActivityListItem
{
    public string RepositoryDisplay =>
        string.IsNullOrEmpty(Branch) ? Repository : $"{Repository} [{Branch}]";

    public override string ToString() =>
        $"{Time}    {RepositoryDisplay}    {Action}    {Status}    {Actor}";
}

internal static class ActivityListBuilder
{
    internal static IReadOnlyList<ActivityListItem> Build(
        IReadOnlyList<AuditEventRecord> events,
        DateTimeOffset nowLocal)
    {
        if (events.Count == 0)
        {
            return new ActivityListItem[]
            {
                new ActivityEventItem(
                    string.Empty,
                    "No audit events recorded yet.",
                    string.Empty,
                    string.Empty,
                    string.Empty),
            };
        }

        var items = new List<ActivityListItem>(events.Count + 4);
        DateOnly? currentDay = null;
        foreach (var entry in events)
        {
            var local = DateTimeOffset.FromUnixTimeSeconds(entry.CreatedAt).ToLocalTime();
            var day = DateOnly.FromDateTime(local.DateTime);
            if (currentDay != day)
            {
                currentDay = day;
                items.Add(new ActivityDaySeparatorItem(FormatDayLabel(day, nowLocal)));
            }

            items.Add(new ActivityEventItem(
                local.ToString("HH:mm", CultureInfo.CurrentCulture),
                entry.Repo ?? "Authority",
                entry.EventType.Replace('_', ' '),
                entry.Outcome,
                "Local user",
                entry.Branch ?? string.Empty));
        }

        return items;
    }

    internal static string FormatDayLabel(DateOnly day, DateTimeOffset nowLocal)
    {
        var today = DateOnly.FromDateTime(nowLocal.DateTime);
        if (day == today) return "Today";
        if (day == today.AddDays(-1)) return "Yesterday";
        return day.ToString("dddd, MMMM d, yyyy", CultureInfo.CurrentCulture);
    }
}

