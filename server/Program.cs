// show server: keeps the pages that an agent makes, and the answers that a person gives on them.
//
//   The agent, with the secret token:      POST/GET /api/pages, GET/PUT/DELETE /api/pages/{id},
//                                          GET /api/pages/{id}/html
//   The browser, with the link of a page:  GET /p/{id}, GET/PUT /p/{id}/state, GET /kit/{file}
//
// The agent sends plain HTML. The server checks it, and adds the stylesheet and the page script
// when a browser asks for the page. The id in a link is 16 random bytes. A person who has the link
// can read the page and change the answers. Only the token can make, list, replace and delete pages.
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Show;

const int MaxPage = 4 * 1024 * 1024;   // a page with drawings has approximately 50 KB; an image as a data: URL makes it larger
const int MaxState = 256 * 1024;       // the answers of a page are a few KB

var builder = WebApplication.CreateSlimBuilder(args);
builder.Logging.AddFilter("Microsoft.AspNetCore", LogLevel.Warning);
builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.TypeInfoResolverChain.Insert(0, AppJson.Wire));
builder.WebHost.ConfigureKestrel(kestrel => kestrel.Limits.MaxRequestBodySize = MaxPage);
// 5000 and 8080 clash with many other tools, so the server has its own port.
if (string.IsNullOrEmpty(builder.Configuration["urls"]) && string.IsNullOrEmpty(builder.Configuration["http_ports"]))
    builder.WebHost.UseUrls("http://0.0.0.0:7469");

var token = builder.Configuration["SHOW_TOKEN"] ?? "";
if (token.Length < 24)
{
    // A short token can be guessed, and the server is reachable from the internet.
    Console.Error.WriteLine("Set SHOW_TOKEN to a random secret of 24 or more characters, for example from: openssl rand -base64 32");
    return 1;
}
var tokenHash = SHA256.HashData(Encoding.UTF8.GetBytes(token));
var publicUrl = (builder.Configuration["SHOW_PUBLIC_URL"] ?? "").TrimEnd('/');
var store = new PageStore(builder.Configuration["SHOW_DATA"] ?? "/data");
var kit = new Kit();

// The browser runs only the script of this server ('self'), so a <script> that somebody puts into
// a page does not run. Styles and images can be inside the page; nothing comes from another site.
// A script on a page can only talk to this server. frame-ancestors stops another site from
// showing the page inside its own page.
const string PagePolicy =
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src data:; font-src 'self'; " +
    "connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'";

var app = builder.Build();

// Each /api request needs the token. This is a middleware and not a filter on each endpoint, so a
// new endpoint under /api cannot be open by mistake.
app.Use(async (context, next) =>
{
    if (context.Request.Path.StartsWithSegments("/api") && !HasToken(context.Request))
    {
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        await context.Response.WriteAsJsonAsync(new ErrorDto("Send the header: Authorization: Bearer <SHOW_TOKEN>"), AppJson.Wire.ErrorDto);
        return;
    }
    await next(context);
});

// ---- the agent ----

app.MapPost("/api/pages", async (HttpRequest request, int? days) =>
{
    var (page, error) = await Upload(request);
    if (page is not { } p) return error!;
    var meta = store.Create(p.Bytes, p.Title, p.Check, Math.Clamp(days ?? 14, 1, 90));
    return Results.Json(ToDto(meta, request), AppJson.Wire.PageDto, statusCode: StatusCodes.Status201Created);
});

app.MapGet("/api/pages", (HttpRequest request) =>
    Results.Json(store.All().Select(meta => ToDto(meta, request)).ToList(), AppJson.Wire.ListPageDto));

app.MapGet("/api/pages/{id}", (string id, HttpRequest request) =>
    store.Meta(id) is { } meta ? Results.Json(ToDto(meta, request), AppJson.Wire.PageDto) : NoPage());

// The HTML as the agent sent it. An agent in a new sandbox gets it, changes it, and sends it back with PUT.
app.MapGet("/api/pages/{id}/html", (string id) =>
    store.Source(id) is { } html ? Results.Bytes(html, "text/html; charset=utf-8") : NoPage());

app.MapPut("/api/pages/{id}", async (string id, HttpRequest request) =>
{
    var (page, error) = await Upload(request);
    if (page is not { } p) return error!;
    return store.Replace(id, p.Bytes, p.Title, p.Check) is { } meta ? Results.Json(ToDto(meta, request), AppJson.Wire.PageDto) : NoPage();
});

app.MapDelete("/api/pages/{id}", (string id) => store.Delete(id) ? Results.NoContent() : NoPage());

// ---- the browser ----

app.MapGet("/p/{id}", (string id, HttpResponse response) =>
{
    if (store.Open(id) is not { } html) return Results.Text("This page does not exist, or its time ended.", statusCode: StatusCodes.Status404NotFound);
    response.Headers.ContentSecurityPolicy = PagePolicy;
    Private(response);
    return Results.Text(PageHtml.Render(Encoding.UTF8.GetString(html), kit.Version), "text/html", Encoding.UTF8);
});

app.MapGet("/p/{id}/state", (string id, HttpResponse response) =>
{
    if (store.Meta(id) is null) return NoPage();
    Private(response);
    // An empty object means "no answers yet".
    return Results.Bytes(store.State(id) ?? "{}"u8.ToArray(), "application/json");
});

app.MapPut("/p/{id}/state", async (string id, HttpRequest request) =>
{
    if (store.Meta(id) is null) return NoPage();
    var (json, error) = await Body(request, MaxState, "state");
    if (json is null) return error!;
    // The server does not read the answers. It only refuses a body that the agent could not parse later.
    try
    {
        using var document = JsonDocument.Parse(json);
        if (document.RootElement.ValueKind != JsonValueKind.Object) throw new JsonException();
    }
    catch (JsonException) { return Problem(StatusCodes.Status400BadRequest, "The state must be one JSON object."); }
    return store.SaveState(id, json) ? Results.NoContent() : NoPage();
});

app.MapGet("/kit/{name}", (string name, HttpRequest request, HttpResponse response) =>
{
    if (!kit.TryGet(name, out var file)) return Results.NotFound();
    // An address with "?v=" names one version of the file for all time. Without it, the file can change.
    response.Headers.CacheControl = request.Query.ContainsKey("v") ? "public, max-age=31536000, immutable" : "public, max-age=3600";
    // Without nosniff, a browser could run a file of a different type as a script.
    response.Headers.XContentTypeOptions = "nosniff";
    return Results.Bytes(file.Bytes, file.Type);
});

app.MapGet("/healthz", () => Results.Text("ok"));

// Remove old pages one time each hour. The first run is at the start.
_ = Task.Run(async () =>
{
    using var timer = new PeriodicTimer(TimeSpan.FromHours(1));
    try
    {
        do
        {
            var removed = store.Sweep();
            if (removed > 0) Console.WriteLine($"Removed {removed} pages after their last day.");
        }
        while (await timer.WaitForNextTickAsync(app.Lifetime.ApplicationStopping));
    }
    catch (OperationCanceledException) { }   // the server stops
});

Console.WriteLine($"show server: pages in {builder.Configuration["SHOW_DATA"] ?? "/data"}, links start with {(publicUrl.Length > 0 ? publicUrl : "the address of each request")}, kit version {kit.Version}");
app.Run();
return 0;

bool HasToken(HttpRequest request)
{
    var header = request.Headers.Authorization.ToString();
    if (!header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)) return false;
    // Compare hashes in fixed time, so the time of the answer tells nothing about the token.
    return CryptographicOperations.FixedTimeEquals(SHA256.HashData(Encoding.UTF8.GetBytes(header[7..].Trim())), tokenHash);
}

PageDto ToDto(PageMeta meta, HttpRequest request)
{
    JsonElement? state = null;
    if (store.State(meta.Id) is { } bytes)
    {
        try
        {
            using var document = JsonDocument.Parse(bytes);
            state = document.RootElement.Clone();
        }
        catch (JsonException) { }   // a broken file is the same as no answers
    }
    // Without SHOW_PUBLIC_URL the link uses the address that the agent called, which a phone can maybe not reach.
    var start = publicUrl.Length > 0 ? publicUrl : $"{request.Scheme}://{request.Host}";
    return new PageDto(meta.Id, $"{start}/p/{meta.Id}", meta.Title, meta.CreatedAt, meta.UpdatedAt, meta.ExpiresAt,
        meta.OpenedAt, meta.SavedAt, meta.Questions ?? [], meta.Warnings ?? [], state);
}

// Reads and checks the HTML of a page from a request. Gives the page, or the error result.
static async Task<((byte[] Bytes, string Title, PageCheck Check)? Page, IResult? Error)> Upload(HttpRequest request)
{
    var (bytes, error) = await Body(request, MaxPage, "page");
    if (bytes is null) return (null, error);
    var html = Encoding.UTF8.GetString(bytes);
    var check = PageHtml.Check(html);
    if (check.Error is not null) return (null, Problem(StatusCodes.Status400BadRequest, check.Error));
    return ((bytes, PageHtml.TitleOf(html) ?? "(no title)", check), null);
}

// Reads a request body of at most `max` bytes. Gives the bytes, or the error result.
static async Task<(byte[]? Bytes, IResult? Error)> Body(HttpRequest request, int max, string what)
{
    var tooLarge = Problem(StatusCodes.Status413PayloadTooLarge, $"The {what} is larger than {max / 1024} KB.");
    if (request.ContentLength > max) return (null, tooLarge);
    using var buffer = new MemoryStream();
    var chunk = new byte[64 * 1024];
    int read;
    try
    {
        while ((read = await request.Body.ReadAsync(chunk)) > 0)
        {
            // A request without Content-Length has no size in its header, so count the bytes.
            if (buffer.Length + read > max) return (null, tooLarge);
            buffer.Write(chunk, 0, read);
        }
    }
    // Kestrel stops a body at its own limit (MaxPage) with this exception. Without the catch, the
    // agent gets a 413 with no text, and the log gets a stack trace.
    catch (BadHttpRequestException) { return (null, tooLarge); }
    return buffer.Length == 0
        ? (null, Problem(StatusCodes.Status400BadRequest, $"Send the {what} as the body of the request."))
        : (buffer.ToArray(), null);
}

static IResult Problem(int status, string message) => Results.Json(new ErrorDto(message), AppJson.Wire.ErrorDto, statusCode: status);

static IResult NoPage() => Problem(StatusCodes.Status404NotFound, "No page has this id, or its time ended.");

// A page link is a secret, and the answers change. No cache keeps them, no search engine lists
// them, and a link on the page does not tell the next site where the person came from.
static void Private(HttpResponse response)
{
    response.Headers.CacheControl = "no-store";
    response.Headers["Referrer-Policy"] = "no-referrer";
    response.Headers.XContentTypeOptions = "nosniff";
    response.Headers["X-Robots-Tag"] = "noindex, nofollow";
}
