using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace GitHubDeliveryAuthority;

internal sealed class ActivityListItemTemplateSelector : DataTemplateSelector
{
    public DataTemplate? DaySeparatorTemplate { get; set; }
    public DataTemplate? EventTemplate { get; set; }

    protected override DataTemplate? SelectTemplateCore(object item) =>
        item is ActivityDaySeparatorItem ? DaySeparatorTemplate : EventTemplate;

    protected override DataTemplate? SelectTemplateCore(object item, DependencyObject container) =>
        SelectTemplateCore(item);
}

