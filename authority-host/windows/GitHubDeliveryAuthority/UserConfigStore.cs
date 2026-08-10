using System.Text.Json;

namespace GitHubDeliveryAuthority;

internal sealed record DeliveryUserConfig(int SchemaVersion, string AuthorityMode);

internal static class UserConfigStore
{
    public static string ConfigPath
    {
        get
        {
            var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            if (string.IsNullOrWhiteSpace(local)) throw new InvalidOperationException("local_appdata_unavailable");
            return Path.Combine(local, "github-delivery", "config.json");
        }
    }

    public static DeliveryUserConfig Read()
    {
        if (!File.Exists(ConfigPath)) return new DeliveryUserConfig(1, "off");
        try
        {
            using var document = JsonDocument.Parse(File.ReadAllText(ConfigPath));
            var root = document.RootElement;
            if (root.GetProperty("schemaVersion").GetInt32() != 1) throw new InvalidOperationException("github_delivery_config_schema_version_unsupported");
            var mode = root.GetProperty("authorityMode").GetString() ?? "";
            if (mode is not ("off" or "high-assurance" or "all")) throw new InvalidOperationException("github_delivery_config_authority_mode_invalid");
            return new DeliveryUserConfig(1, mode);
        }
        catch (JsonException error)
        {
            throw new InvalidOperationException("github_delivery_config_invalid_json", error);
        }
    }

    public static string DisplayMode(string mode) => mode switch
    {
        "off" => "Hello off",
        "high-assurance" => "Sensitive actions",
        "all" => "Hello on",
        _ => "Invalid configuration",
    };
}
