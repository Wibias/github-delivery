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
        if (!File.Exists(ConfigPath)) return new DeliveryUserConfig(1, "high-assurance");
        try
        {
            using var document = JsonDocument.Parse(File.ReadAllText(ConfigPath));
            var root = document.RootElement;
            if (root.GetProperty("schemaVersion").GetInt32() != 1) throw new InvalidOperationException("github_delivery_config_schema_version_unsupported");
            var mode = root.GetProperty("authorityMode").GetString() ?? "";
            ValidateMode(mode);
            return new DeliveryUserConfig(1, mode);
        }
        catch (JsonException error)
        {
            throw new InvalidOperationException("github_delivery_config_invalid_json", error);
        }
    }

    public static DeliveryUserConfig WriteAuthorityMode(string mode)
    {
        ValidateMode(mode);
        var config = new DeliveryUserConfig(1, mode);
        var directory = Path.GetDirectoryName(ConfigPath);
        if (string.IsNullOrWhiteSpace(directory)) throw new InvalidOperationException("github_delivery_config_path_invalid");
        Directory.CreateDirectory(directory);

        var temporaryPath = $"{ConfigPath}.{Environment.ProcessId}.{Guid.NewGuid():N}.tmp";
        var json = JsonSerializer.Serialize(config, new JsonSerializerOptions
        {
            WriteIndented = true,
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        }) + Environment.NewLine;
        File.WriteAllText(temporaryPath, json);
        try
        {
            File.Move(temporaryPath, ConfigPath, true);
        }
        finally
        {
            if (File.Exists(temporaryPath)) File.Delete(temporaryPath);
        }
        return config;
    }

    public static string DisplayMode(string mode) => mode switch
    {
        "off" => "Off",
        "high-assurance" => "Sensitive actions",
        "all" => "Every GitHub write",
        _ => "Invalid configuration",
    };

    private static void ValidateMode(string mode)
    {
        if (mode is not ("off" or "high-assurance" or "all"))
            throw new InvalidOperationException("github_delivery_config_authority_mode_invalid");
    }
}
