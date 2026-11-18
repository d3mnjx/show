using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Show;

/// <summary>
/// What the server knows about one page. The page and the answers are in their own files.
/// Questions and Warnings come from the check of the HTML at the time of the upload.
/// </summary>
internal sealed record PageMeta(
    string Id, string Title,
    DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt, DateTimeOffset ExpiresAt,
    DateTimeOffset? OpenedAt, DateTimeOffset? SavedAt,
    List<string>? Questions = null, List<string>? Warnings = null);

/// <summary>
/// Keeps each page as one folder: page.html (from the agent), state.json (the answers, from the
/// browser) and meta.json. Files are sufficient, because one person and a few agents use the server.
/// </summary>
internal sealed partial class PageStore(string root)
{
    // One lock for all pages. The traffic is a few requests in a minute, so a lock for each page
    // would add code and no speed.
    private readonly Lock gate = new();

    // An id is 16 random bytes as base64url. This pattern is also the guard against a path such as "../x".
    [GeneratedRegex("^[A-Za-z0-9_-]{22}$")]
    private static partial Regex IdPattern();

    public PageMeta Create(byte[] html, string title, PageCheck check, int days)
    {
        var now = DateTimeOffset.UtcNow;
        var id = Convert.ToBase64String(RandomNumberGenerator.GetBytes(16)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var meta = new PageMeta(id, title, now, now, now.AddDays(days), null, null, check.Questions, check.Warnings);
        lock (gate)
        {
            Directory.CreateDirectory(Path.Combine(root, id));
            Write(id, "page.html", html);
            WriteMeta(meta);
        }
        return meta;
    }

    /// <summary>Puts a new version of the page in place. The answers stay.</summary>
    public PageMeta? Replace(string id, byte[] html, string title, PageCheck check)
    {
        lock (gate)
        {
            if (ReadMeta(id) is not { } meta) return null;
            meta = meta with { Title = title, UpdatedAt = DateTimeOffset.UtcNow, Questions = check.Questions, Warnings = check.Warnings };
            Write(id, "page.html", html);
            WriteMeta(meta);
            return meta;
        }
    }

    public PageMeta? Meta(string id)
    {
        lock (gate) return ReadMeta(id);
    }

    /// <summary>The HTML as the agent sent it.</summary>
    public byte[]? Source(string id)
    {
        lock (gate) return ReadMeta(id) is null ? null : Read(id, "page.html");
    }

    /// <summary>The page for a browser. The first call records the time, so the agent sees that the person opened the link.</summary>
    public byte[]? Open(string id)
    {
        lock (gate)
        {
            if (ReadMeta(id) is not { } meta) return null;
            if (meta.OpenedAt is null) WriteMeta(meta with { OpenedAt = DateTimeOffset.UtcNow });
            return Read(id, "page.html");
        }
    }

    public byte[]? State(string id)
    {
        lock (gate) return ReadMeta(id) is null ? null : Read(id, "state.json");
    }

    public bool SaveState(string id, byte[] json)
    {
        lock (gate)
        {
            if (ReadMeta(id) is not { } meta) return false;
            Write(id, "state.json", json);
            WriteMeta(meta with { SavedAt = DateTimeOffset.UtcNow });
            return true;
        }
    }

    public bool Delete(string id)
    {
        lock (gate)
        {
            if (!IdPattern().IsMatch(id) || !Directory.Exists(Path.Combine(root, id))) return false;
            Directory.Delete(Path.Combine(root, id), recursive: true);
            return true;
        }
    }

    public List<PageMeta> All()
    {
        lock (gate)
        {
            if (!Directory.Exists(root)) return [];
            return [.. Directory.EnumerateDirectories(root)
                .Select(dir => ReadMeta(Path.GetFileName(dir)))
                .OfType<PageMeta>()
                .OrderByDescending(meta => meta.CreatedAt)];
        }
    }

    /// <summary>Removes each page after its last day. Returns the number of removed pages.</summary>
    public int Sweep()
    {
        lock (gate)
        {
            if (!Directory.Exists(root)) return 0;
            var removed = 0;
            foreach (var dir in Directory.EnumerateDirectories(root).ToList())
            {
                var id = Path.GetFileName(dir);
                // ReadMeta gives null for a page after its last day. A folder with a different name is not a page.
                if (!IdPattern().IsMatch(id) || ReadMeta(id) is not null) continue;
                try { Directory.Delete(dir, recursive: true); removed++; }
                catch (IOException) { }   // the next sweep tries again
            }
            return removed;
        }
    }

    // A page after its last day is the same as no page, also before the sweep removed its folder.
    private PageMeta? ReadMeta(string id)
    {
        if (!IdPattern().IsMatch(id) || Read(id, "meta.json") is not { } bytes) return null;
        try
        {
            var meta = JsonSerializer.Deserialize(bytes, AppJson.Wire.PageMeta);
            return meta is null || meta.ExpiresAt <= DateTimeOffset.UtcNow ? null : meta;
        }
        catch (JsonException) { return null; }
    }

    private void WriteMeta(PageMeta meta) =>
        Write(meta.Id, "meta.json", JsonSerializer.SerializeToUtf8Bytes(meta, AppJson.Wire.PageMeta));

    private byte[]? Read(string id, string name)
    {
        var path = Path.Combine(root, id, name);
        return File.Exists(path) ? File.ReadAllBytes(path) : null;
    }

    // Write a new file and move it over the old one. A crash in the middle then leaves the old file complete.
    private void Write(string id, string name, byte[] bytes)
    {
        var path = Path.Combine(root, id, name);
        File.WriteAllBytes(path + ".tmp", bytes);
        File.Move(path + ".tmp", path, overwrite: true);
    }
}

/// <summary>A page as the agent gets it. State is what the browser saved last, or null before the first answer.</summary>
internal sealed record PageDto(
    string Id, string Url, string Title,
    DateTimeOffset CreatedAt, DateTimeOffset UpdatedAt, DateTimeOffset ExpiresAt,
    DateTimeOffset? OpenedAt, DateTimeOffset? SavedAt,
    List<string> Questions, List<string> Warnings, JsonElement? State);

internal sealed record ErrorDto(string Error);

// Native AOT has no reflection for JSON, so each type that goes over the wire is listed here.
[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(PageMeta))]
[JsonSerializable(typeof(PageDto))]
[JsonSerializable(typeof(List<PageDto>))]
[JsonSerializable(typeof(ErrorDto))]
internal sealed partial class AppJson : JsonSerializerContext
{
    // The context for each answer of the server. The default encoder writes "<" as "\u003C",
    // because it makes JSON that is safe inside an HTML page. The answers of this server are
    // JSON only, and an agent reads the error sentences, so they keep their characters.
    public static AppJson Wire { get; } = new(new JsonSerializerOptions
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    });
}
