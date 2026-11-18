using System.Net;
using System.Text.RegularExpressions;

namespace Show;

/// <summary>
/// What the server found in the HTML of a page. Error is one sentence that says what to change;
/// the server then refuses the page. Questions are the data-q ids in the order of the page.
/// </summary>
internal sealed record PageCheck(string? Error, List<string> Questions, List<string> Warnings);

/// <summary>
/// Checks the HTML that an agent sends, and makes the HTML that a browser gets.
/// The server reads the page format with regular expressions and not with an HTML parser, so it
/// has no package from NuGet. The checks keep the markup of a question inside what these
/// expressions can read. web/page.js reads the same markup in the browser.
/// </summary>
internal static partial class PageHtml
{
    private const RegexOptions Loose = RegexOptions.IgnoreCase | RegexOptions.Singleline;

    [GeneratedRegex(@"<script\b", Loose)]
    private static partial Regex Script();

    // A tag that makes the browser get a file from another site. A link (<a href>) is not in the list.
    [GeneratedRegex(@"<(img|video|audio|source|track|iframe|embed|object|link)\b[^>]*?(?<![-\w])(?:src|href|data)\s*=\s*[""']?\s*(?:https?:)?//", Loose)]
    private static partial Regex RemoteFile();

    [GeneratedRegex(@"url\(\s*[""']?\s*(?:https?:)?//", Loose)]
    private static partial Regex RemoteCss();

    [GeneratedRegex(@"<fieldset\b([^>]*)>(.*?)</fieldset>", Loose)]
    private static partial Regex Fieldset();

    [GeneratedRegex(@"<fieldset\b[^>]*\bclass\s*=\s*[""'][^""']*\bask\b", Loose)]
    private static partial Regex AskOpen();

    // An option is an <input> and the <b> label that follows it directly.
    [GeneratedRegex(@"<input\b([^>]*)>\s*(?:<b\b[^>]*>(.*?)</b>)?", Loose)]
    private static partial Regex Input();

    [GeneratedRegex(@"<textarea\b([^>]*)>", Loose)]
    private static partial Regex Textarea();

    [GeneratedRegex(@"<legend\b[^>]*>(.*?)</legend>", Loose)]
    private static partial Regex Legend();

    [GeneratedRegex(@"<(?:select|button)\b", Loose)]
    private static partial Regex OtherControl();

    // A tag inside a label, for example "recommended". It is not a part of the text of the answer.
    [GeneratedRegex(@"<span\b[^>]*\bclass\s*=\s*[""'][^""']*\btag\b[^""']*[""'][^>]*>.*?</span>", Loose)]
    private static partial Regex TagSpan();

    [GeneratedRegex(@"([^\s""'<>/=]+)(?:\s*=\s*(?:""([^""]*)""|'([^']*)'|([^\s""'>]+)))?")]
    private static partial Regex Attribute();

    [GeneratedRegex(@"<[^>]*>")]
    private static partial Regex AnyTag();

    [GeneratedRegex(@"\s+")]
    private static partial Regex Space();

    [GeneratedRegex(@"^[a-z][a-z0-9-]*$", RegexOptions.IgnoreCase)]
    private static partial Regex QuestionId();

    [GeneratedRegex(@"<title\b[^>]*>(.*?)</title>", Loose)]
    private static partial Regex Title();

    [GeneratedRegex(@"<h1\b[^>]*>(.*?)</h1>", Loose)]
    private static partial Regex Heading();

    // \b keeps <header> out.
    [GeneratedRegex(@"<head\b[^>]*>", Loose)]
    private static partial Regex HeadOpen();

    [GeneratedRegex(@"<meta\b[^>]*\bname\s*=\s*[""']?viewport", Loose)]
    private static partial Regex Viewport();

    [GeneratedRegex(@"\bclass\s*=\s*[""'][^""']*\bpage\b", Loose)]
    private static partial Regex PageClass();

    public static PageCheck Check(string html)
    {
        var questions = new List<string>();
        var warnings = new List<string>();
        PageCheck Fail(string message) => new(message, questions, warnings);

        // The content security policy of a page permits only the script of the server. A page with
        // a script of its own would be broken without a message, so the server refuses it here.
        if (Script().IsMatch(html))
            return Fail("The page contains a <script> tag. The browser runs only the script of the server and blocks each other script. Remove the tag. For a part that opens and closes, use <details>.");
        if (RemoteFile().Match(html) is { Success: true } remote)
            return Fail($"The page loads a file from another site in a <{remote.Groups[1].Value.ToLowerInvariant()}> tag. The browser blocks it. Put an image into the page as a data: URL or as inline <svg>, and put styles into a <style> tag.");
        // This is a warning and not an error, because the text can also be in a code example.
        if (RemoteCss().IsMatch(html))
            warnings.Add("A style of the page loads a file from another site with url(...). The browser blocks it. Use a data: URL.");
        if (TitleOf(html) is null)
            warnings.Add("The page has no <title> and no <h1>. The list of pages shows it as \"(no title)\".");

        var asks = Fieldset().Matches(html).Where(m => HasClass(Attributes(m.Groups[1].Value), "ask")).ToList();
        var opened = AskOpen().Count(html);
        if (opened != asks.Count)
            return Fail($"The page has {opened} <fieldset class=\"ask\"> tags, but only {asks.Count} are complete. Give each one a closing </fieldset>, and do not put one inside another.");

        foreach (var ask in asks)
        {
            var id = Attributes(ask.Groups[1].Value).GetValueOrDefault("data-q", "");
            var body = ask.Groups[2].Value;
            var question = TextOf(Legend().Match(body).Groups[1].Value);
            var where = $"The question \"{(id.Length > 0 ? id : question)}\"";

            if (!QuestionId().IsMatch(id)) return Fail($"{where} needs data-q with a short id, for example data-q=\"storage\". Use letters, digits and \"-\".");
            if (questions.Contains(id)) return Fail($"Two questions have data-q=\"{id}\". Give each question its own id.");
            questions.Add(id);
            if (question.Length == 0) return Fail($"{where} needs a <legend> with the text of the question.");

            var options = 0;
            var values = new HashSet<string>();
            foreach (Match match in Input().Matches(body))
            {
                var input = Attributes(match.Groups[1].Value);
                // A mockup inside a question must not contain a real control: the page would send
                // its state as an answer.
                if (input.GetValueOrDefault("type") is not ("radio" or "checkbox"))
                    return Fail($"{where} contains an <input> that is not an option. Draw a control of a mockup with a <span>.");
                options++;
                // The browser groups radio buttons by name. A different name would let a person select two answers.
                if (input.GetValueOrDefault("name") != id)
                    return Fail($"{where} has an option with name=\"{input.GetValueOrDefault("name", "")}\". Each option of a question needs name=\"{id}\".");
                var value = input.GetValueOrDefault("value", "");
                if (value.Length == 0) return Fail($"{where} has an option without a value attribute.");
                if (!values.Add(value)) return Fail($"{where} has two options with value=\"{value}\".");
                if (TextOf(TagSpan().Replace(match.Groups[2].Value, "")).Length == 0)
                    return Fail($"{where} has an option without a <b> label directly after its <input>.");
                // A selected option counts as an answer, and the person did not give it.
                if (input.ContainsKey("checked"))
                    return Fail($"{where} has an option with the attribute checked. Remove it. The person makes each selection.");
            }
            if (OtherControl().IsMatch(body))
                return Fail($"{where} contains a <select> or a <button>. Draw a control of a mockup with a <span>.");

            var notes = Textarea().Matches(body);
            if (notes.Count > 1) return Fail($"{where} has {notes.Count} <textarea> tags. A question has one <textarea>.");
            if (options == 0 && notes.Count == 0) return Fail($"{where} has no option and no <textarea>, so a person cannot answer it.");
            // The stylesheet shows a text question as answered with :placeholder-shown, and that needs a placeholder attribute.
            if (options == 0 && !Attributes(notes[0].Groups[1].Value).ContainsKey("placeholder"))
                return Fail($"{where} has only a <textarea>. Give that <textarea> a placeholder attribute, for example placeholder=\"Your answer\".");
            if (notes.Count == 0) warnings.Add($"The question \"{id}\" has no <textarea> for a note.");
        }
        return new PageCheck(null, questions, warnings);
    }

    /// <summary>The name of the page for the list of pages: the title, or the first heading. Null when the page has neither.</summary>
    public static string? TitleOf(string html)
    {
        var title = TextOf(Title().Match(html).Groups[1].Value);
        if (title.Length == 0) title = TextOf(Heading().Match(html).Groups[1].Value);
        return title.Length == 0 ? null : title[..Math.Min(title.Length, 200)];
    }

    /// <summary>
    /// The HTML for the browser. The server adds the stylesheet and the script here, at each request,
    /// and not when the agent sends the page. The stored file stays what the agent wrote, and a
    /// change of the stylesheet reaches each page.
    /// </summary>
    public static string Render(string html, string version)
    {
        // The stylesheet comes first in the <head>, so a <style> of the page can change its rules.
        // "defer" runs the script after the browser read the full page.
        var kit = $"<link rel=\"stylesheet\" href=\"/kit/page.css?v={version}\">\n<script src=\"/kit/page.js?v={version}\" defer></script>";
        // Without this tag a phone shows the page at the width of a desktop.
        if (!Viewport().IsMatch(html)) kit = "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n" + kit;

        if (HeadOpen().Match(html) is { Success: true } head)
            return html.Insert(head.Index + head.Length, "\n" + kit);

        // The agent sent only the content, without the frame of a document. The server adds the frame.
        var title = WebUtility.HtmlEncode(TitleOf(html) ?? "(no title)");
        // .page is the reading column of the stylesheet. Content that has it already gets no second one.
        var body = PageClass().IsMatch(html) ? html : $"<main class=\"page\">\n{html}\n</main>";
        return $"<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n{kit}\n<title>{title}</title>\n</head>\n<body>\n{body}\n</body>\n</html>\n";
    }

    private static Dictionary<string, string> Attributes(string tag)
    {
        var found = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (Match m in Attribute().Matches(tag))
        {
            var value = m.Groups[2].Success ? m.Groups[2].Value : m.Groups[3].Success ? m.Groups[3].Value : m.Groups[4].Value;
            found[m.Groups[1].Value] = WebUtility.HtmlDecode(value);
        }
        return found;
    }

    private static bool HasClass(Dictionary<string, string> attributes, string name) =>
        attributes.GetValueOrDefault("class", "").Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).Contains(name);

    private static string TextOf(string markup) =>
        Space().Replace(WebUtility.HtmlDecode(AnyTag().Replace(markup, " ")), " ").Trim();
}
