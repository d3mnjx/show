using System.Security.Cryptography;
using System.Text;

namespace Show;

/// <summary>
/// The files that each page loads from the server: the stylesheet, the page script and the fonts.
/// They are in web/ and are compiled into the binary, so a deploy is one file with nothing next to it.
/// </summary>
internal sealed class Kit
{
    private readonly Dictionary<string, (byte[] Bytes, string Type)> files = new(StringComparer.Ordinal);

    /// <summary>
    /// Changes when a file in web/ changes. Each address of a kit file has it as "?v=", so a
    /// browser can keep a file for a year and still gets a new version at once.
    /// </summary>
    public string Version { get; }

    public Kit()
    {
        var assembly = typeof(Kit).Assembly;
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        foreach (var name in assembly.GetManifestResourceNames().Order(StringComparer.Ordinal))
        {
            using var stream = assembly.GetManifestResourceStream(name)!;
            using var buffer = new MemoryStream();
            stream.CopyTo(buffer);
            files[name] = (buffer.ToArray(), TypeOf(name));
            hash.AppendData(buffer.ToArray());
        }
        Version = Convert.ToHexStringLower(hash.GetHashAndReset())[..12];

        // The stylesheet names the fonts without a version. Add it, so the browser keeps the fonts too.
        var css = Encoding.UTF8.GetString(files["page.css"].Bytes).Replace(".woff2)", $".woff2?v={Version})");
        files["page.css"] = (Encoding.UTF8.GetBytes(css), files["page.css"].Type);
    }

    public bool TryGet(string name, out (byte[] Bytes, string Type) file) => files.TryGetValue(name, out file);

    private static string TypeOf(string name) => Path.GetExtension(name) switch
    {
        ".css" => "text/css; charset=utf-8",
        ".js" => "text/javascript; charset=utf-8",
        ".woff2" => "font/woff2",
        _ => "text/plain; charset=utf-8",
    };
}
