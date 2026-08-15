import { readFileSync, writeFileSync } from "node:fs";

const xamlPath = "authority-host/windows/GitHubDeliveryAuthority/ControlCenterWindow.xaml";
const codePath = "authority-host/windows/GitHubDeliveryAuthority/ControlCenterWindow.xaml.cs";

let xaml = readFileSync(xamlPath, "utf8");
let code = readFileSync(codePath, "utf8");

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(`${label}_target_missing`);
  if (source.indexOf(before, first + before.length) >= 0) throw new Error(`${label}_target_ambiguous`);
  return source.slice(0, first) + after + source.slice(first + before.length);
}

xaml = replaceOnce(
  xaml,
  `                                        <Button Grid.Column="1"\n                                                Content="View full activity"\n                                                Style="{StaticResource AccentButtonStyle}"\n                                                Padding="9,3"\n                                                IsEnabled="False" />\n`,
  "",
  "activity_button",
);

xaml = replaceOnce(
  xaml,
  `                                        <Button Grid.Column="1"\n                                                Content="+ Add repository"\n                                                Padding="7,2"\n                                                IsEnabled="False" />\n`,
  `                                        <StackPanel Grid.Column="1" Orientation="Horizontal" Spacing="8">\n                                            <Button x:Name="AddRepositoryButton"\n                                                    Content="+ Add repository"\n                                                    Padding="7,2"\n                                                    Click="AddRepository_Click" />\n                                            <Button x:Name="RemoveRepositoryButton"\n                                                    Content="Remove selected"\n                                                    Padding="7,2"\n                                                    IsEnabled="False"\n                                                    Click="RemoveRepository_Click" />\n                                        </StackPanel>\n`,
  "allowlist_actions",
);

xaml = replaceOnce(
  xaml,
  `                                    <ListView x:Name="AllowlistList"\n                                              SelectionMode="None"\n                                              MinHeight="135"\n`,
  `                                    <ListView x:Name="AllowlistList"\n                                              SelectionMode="Single"\n                                              SelectionChanged="AllowlistList_SelectionChanged"\n                                              MinHeight="135"\n`,
  "allowlist_selection",
);

xaml = replaceOnce(
  xaml,
  `                                    </ListView>\n                                </StackPanel>\n                            </Border>\n\n                            <Border x:Name="GrantCard"\n`,
  `                                    </ListView>\n                                    <TextBlock x:Name="AllowlistStatusText"\n                                               Text=""\n                                               Opacity="0.72"\n                                               TextWrapping="WrapWholeWords" />\n                                </StackPanel>\n                            </Border>\n\n                            <Border x:Name="GrantCard"\n`,
  "allowlist_status",
);

const branchRecord = `    private sealed record BranchLeaseListItem(string LeaseId, string Display)\n    {\n        public override string ToString() => Display;\n    }\n\n`;
code = replaceOnce(
  code,
  branchRecord,
  `${branchRecord}    private sealed record RepositoryListItem(string Repo, string Display)\n    {\n        public override string ToString() => Display;\n    }\n\n`,
  "repository_item",
);

code = replaceOnce(
  code,
  `        AllowlistedCount.Text = repositories.Count.ToString(CultureInfo.InvariantCulture);\n        AllowlistList.ItemsSource = repositories.Count == 0\n            ? new[] { "No repositories allowlisted" }\n            : repositories.Select(repo => $"▣  {repo}     Allowed").ToArray();\n\n`,
  `        AllowlistedCount.Text = repositories.Count.ToString(CultureInfo.InvariantCulture);\n        AllowlistList.ItemsSource = repositories.Count == 0\n            ? new[] { new RepositoryListItem(string.Empty, "No repositories allowlisted") }\n            : repositories.Select(repo => new RepositoryListItem(repo, $"▣  {repo}")).ToArray();\n        AllowlistList.SelectedItem = null;\n        RemoveRepositoryButton.IsEnabled = false;\n\n`,
  "allowlist_refresh",
);

const grantHandler = `    private void GrantList_SelectionChanged(object sender, SelectionChangedEventArgs e)\n    {\n        RevokeGrantButton.IsEnabled = GrantList.SelectedItem is BranchLeaseListItem item && !string.IsNullOrEmpty(item.LeaseId);\n    }\n\n`;
const allowlistHandlers = `    private void AllowlistList_SelectionChanged(object sender, SelectionChangedEventArgs e)\n    {\n        RemoveRepositoryButton.IsEnabled =\n            AllowlistList.SelectedItem is RepositoryListItem item && !string.IsNullOrEmpty(item.Repo);\n    }\n\n    private async void AddRepository_Click(object sender, RoutedEventArgs e)\n    {\n        var input = new TextBox\n        {\n            Header = "Repository",\n            PlaceholderText = "owner/repo",\n        };\n        var dialog = new ContentDialog\n        {\n            XamlRoot = RootLayout.XamlRoot,\n            Title = "Add repository",\n            Content = input,\n            PrimaryButtonText = "Add",\n            CloseButtonText = "Cancel",\n            DefaultButton = ContentDialogButton.Primary,\n        };\n\n        if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;\n        var repo = input.Text.Trim();\n        if (string.IsNullOrEmpty(repo))\n        {\n            AllowlistStatusText.Text = "Enter a repository as owner/repo.";\n            return;\n        }\n\n        if (!await VerifyHelloAsync($"Add {repo} to Delivery Authority trusted grants?")) return;\n        try\n        {\n            _store.SetRepositoryAllowed(repo, true, DateTimeOffset.UtcNow.ToUnixTimeSeconds());\n            AllowlistStatusText.Text = $"Added {repo}.";\n            Refresh();\n        }\n        catch (Exception error)\n        {\n            AllowlistStatusText.Text = $"Could not add repository: {error.Message}";\n        }\n    }\n\n    private async void RemoveRepository_Click(object sender, RoutedEventArgs e)\n    {\n        if (AllowlistList.SelectedItem is not RepositoryListItem item || string.IsNullOrEmpty(item.Repo)) return;\n        var repo = item.Repo;\n        if (!await VerifyHelloAsync($"Remove {repo} from the Delivery Authority allowlist?")) return;\n\n        try\n        {\n            _store.SetRepositoryAllowed(repo, false, DateTimeOffset.UtcNow.ToUnixTimeSeconds());\n            AllowlistStatusText.Text = $"Removed {repo}.";\n            Refresh();\n        }\n        catch (Exception error)\n        {\n            AllowlistStatusText.Text = $"Could not remove repository: {error.Message}";\n        }\n    }\n\n    private async Task<bool> VerifyHelloAsync(string message)\n    {\n        var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(this);\n        var verification = await HelloVerifier.VerifyAsync(hwnd, message);\n        if (verification.Verified) return true;\n\n        AllowlistStatusText.Text = verification.FailureMessage ?? "Windows Hello verification was cancelled.";\n        if (verification.CanOpenSignInOptions) WindowsSettings.OpenSignInOptions();\n        return false;\n    }\n\n`;
code = replaceOnce(code, grantHandler, allowlistHandlers + grantHandler, "allowlist_handlers");

writeFileSync(xamlPath, xaml, "utf8");
writeFileSync(codePath, code, "utf8");
