using System.Globalization;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace GitHubDeliveryAuthority;

internal static class CanonicalJson
{
    private static readonly JsonSerializerOptions StringOptions = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        WriteIndented = false,
    };

    public static string Serialize(JsonNode? node)
    {
        return node switch
        {
            null => "null",
            JsonObject obj => SerializeObject(obj),
            JsonArray array => $"[{string.Join(',', array.Select(Serialize))}]",
            JsonValue value => SerializeValue(value),
            _ => throw new AuthorityException("canonical_json_type_invalid"),
        };
    }

    private static string SerializeObject(JsonObject obj)
    {
        var parts = obj
            .Where(pair => pair.Value is not null)
            .OrderBy(pair => pair.Key, StringComparer.Ordinal)
            .Select(pair => $"{JsonSerializer.Serialize(pair.Key, StringOptions)}:{Serialize(pair.Value)}");
        return $"{{{string.Join(',', parts)}}}";
    }

    private static string SerializeValue(JsonValue value)
    {
        if (value.TryGetValue<string>(out var text))
        {
            return JsonSerializer.Serialize(text, StringOptions);
        }
        if (value.TryGetValue<bool>(out var boolean))
        {
            return boolean ? "true" : "false";
        }
        if (value.TryGetValue<int>(out var integer))
        {
            return integer.ToString(System.Globalization.CultureInfo.InvariantCulture);
        }
        if (value.TryGetValue<long>(out var longInteger))
        {
            return longInteger.ToString(System.Globalization.CultureInfo.InvariantCulture);
        }
        if (value.TryGetValue<double>(out var number))
        {
            if (!double.IsFinite(number)) throw new AuthorityException("canonical_json_number_invalid");
            return number.ToString("R", System.Globalization.CultureInfo.InvariantCulture);
        }
        return value.ToJsonString(StringOptions);
    }
}
