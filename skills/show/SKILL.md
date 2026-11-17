---
name: show
description: Make a web page that explains a topic to the user and asks them questions, and read their answers back from the page. The page has a known look (IBM Plex fonts, one reading column) and a toolbox of elements, such as tables, diagrams, option cards, and mockups that show how a change looks in the user's app. The user selects answers, writes notes and comments in the browser, also on a phone. Use it when a feature, a plan, a design or a code review has open decisions for the user, when the user wants to see and compare how a change looks in the app, when the user asks you to show something on a page, when the user asks for mockups, or when the user asks for a page they can answer in.
compatibility: Needs Node.js 18 or newer and the nsite-artifacts skill (https://github.com/jooray/nsite-clay) to publish the page and to read it back.
metadata:
  version: "0.3.0"
---

# show

You show a topic to the user on a web page, and the page asks questions. The user opens a link,
reads, selects answers and writes notes. The page saves each answer. You read the answers later
with one command.

This skill gives you three things:

- `assets/template.html` is a complete example page. It shows each element that the stylesheet has.
- `scripts/page.mjs build` puts the stylesheet, the fonts and the page script into your file.
- `scripts/page.mjs answers` reads the answers from a saved page and prints them as JSON.

The **nsite-artifacts** skill publishes the page and reads it back. Its script is written as
`artifact` below. Read the SKILL.md of that skill before your first page. Its rules about links,
expiry and public pages apply here too.

If the nsite-artifacts skill is not installed, install it next to this skill:

    curl -fsSL -o nsite-artifacts.zip https://nsite-clay.cypherpunk.today/skills/nsite-artifacts.zip
    unzip -oq nsite-artifacts.zip -d <the folder that contains this skill's folder>

## How to read this skill

This skill has two types of content.

- **The contract** is a short list of technical rules. Without them the page cannot save the
  answers, or you cannot read them back. The build checks most of them.
- **The guidance** is all other content: the shape of a page, the elements, the questions, the
  mockups, the text. It describes what worked well. It is not a form to fill in. Use your judgement.
  When the topic needs a different structure, a different element or a drawing that this skill does
  not have, make it. The goal is that the user understands the topic fast and can decide.

The look stays the same on each page: the fonts, the colors, the one column. A new element uses the
color variables of the stylesheet, so that it looks like a part of the page.

## The steps

### 1. Write the content file

Copy `assets/template.html` to a work file and replace its content with yours. Keep the document
frame (`<html lang>`, the two `<meta>` tags, `<title>`, `<div class="page">`). The `<style>` in the
template holds only the look of the example app for its mockups. Replace it with styles that your
page needs, or remove it.

### 2. Build the page

    node <this skill's folder>/scripts/page.mjs build work.html --out=page.html

The command answers `{ "file", "bytes", "questions", "warnings" }`. On an error it prints one
sentence that says what to change. Correct the content file and build again.

- `--css=<file>` adds a stylesheet file to the page, for example the mockup styles of an app.
- `--no-fonts` leaves the fonts out, and the page uses the fonts of the device. The page is then
  approximately 190 KB smaller. Use it only when the user asks for it.

You can also build a page that is built already, for example a saved page from step 5. The build
then replaces only the stylesheet and the script of this skill, and colors new code blocks. It
keeps the answers and the comments.

### 3. Publish the page

    artifact create page.html --edit=link --expires=14d --gateway='https://{host}.nsite.run'

`--edit=link` is necessary. Without it the page cannot save the answers.

`--gateway` selects the web server in the link. The gateway `nsite.run` showed a saved page again
after less than 20 seconds. The default gateway `nsite.lol` answered "Bad Gateway" for more than
20 minutes after each save (both measured on 2026-11-17). If the settings file of the user names a
gateway, leave `--gateway` out and use the gateway of the user.

Before you send the link, make sure that the web address of the page answers. The `url` field is
the address without the key. This command must print `200`:

    curl -s -o /dev/null -w '%{http_code}' <url>

A new page needs approximately 20 seconds. Then send the user the `link` field, exactly as
returned. Tell the user these things in plain sentences:

- how many questions the page has,
- that each person who has the link can open the page and change the answers,
- the date on which the page goes away,
- that they can select words on the page and attach a comment.

Remember the `id` and the title of the page. Do not write the link into a file, a memory or a
commit, because the link contains the key of the page.

### 4. Read the answers

Read the page when the user tells you that they answered. Do not poll.

    artifact read <id> --as=html --out=saved.html
    node <this skill's folder>/scripts/page.mjs answers saved.html

The second command answers:

    { "title": "Deleted Notes Decisions", "answered": 3, "total": 4,
      "questions": [
        { "n": 1, "id": "keep-time", "question": "How long does a note stay in the trash?",
          "picks": [ { "value": "30d", "label": "30 days." } ],
          "note": "Show the days that are left." } ] }

`picks` is empty when the user selected nothing. A question has an answer when it has a pick or a
note. Read each note. A note can change or replace the selected answer.

Read the comments too. Act on a comment as on a request in the chat, then answer it on the page:

    artifact comments <id>
    artifact reply <id> <comment id> --text="What you did." --resolve --by=<your name>

If a question has no answer, ask the user about it in the chat, or continue with your recommended
answer and say that you did so.

**When you did not publish the page yourself**, you do not have its key, and `artifact read` does
not work. Ask the user to tap "Copy the answers" at the end of the page and to paste the text into
the chat. The text has one line for each question: `id: value | note: text`.

### 5. Change a published page

The saved page contains the answers and the comments. A new build from the content file does not
contain them. Thus change the saved page:

    artifact read <id> --as=html --out=saved.html
    (edit the text in saved.html; keep the form controls, the <style> and the <script> as they are)
    node <this skill's folder>/scripts/page.mjs build saved.html --out=changed.html
    artifact update <id> changed.html

The build step checks your edit and colors a code block that you added. Keep the block
`<aside nc:comments>` and each `<mark nc:c="...">` of an open comment, or the comments are lost.

The link stays the same. Do not update a page while the user answers it: the open tab of the user
then holds an old copy, and the page refuses to save from an old copy. When the questions change
much, publish a new page and delete the old one.

### 6. Delete the page

    artifact delete <id>

Delete the page when the work that it belongs to is complete.

## The contract

These rules are technical. The page breaks without them.

1. **One file, and nothing from another site.** No web fonts, no scripts from a CDN, no remote
   images. `artifact create` refuses such a page.
2. **A question is a `<fieldset class="ask" data-q="id">`** with a `<legend>`. Each option is an
   `<input type="radio">` or `<input type="checkbox">` with `name` equal to the id and a `value` of
   its own, directly followed by a `<b>` with the text of the answer. A question has at most one
   `<textarea>`, and no other control. A question without options has only a `<textarea>` with a
   `placeholder` attribute. The section "Questions" shows the markup.
3. **The content is markup in the file.** Do not let a script draw content when the page loads.
   The page saves its own markup, and such a script would draw the content a second time or remove
   the saved answers. When a page has many equal parts, make the content file with a script of your
   own before the build.
4. **A script must not set a class or an attribute on the content.** The page would save that
   change. Show state with CSS, for example `:has(input:checked)`.
5. **An element that a script adds for one viewer needs the attribute `nc:chrome`.** Examples are
   a computed total and a status line. The page does not save such an element. The nsite-artifacts
   SKILL.md, section "Any other page, including an app", has all rules for a script in a page that
   saves itself.
6. **No `checked` on an option.** The user makes each selection.

## Guidance: the shape of a page

Decide the shape from the topic. Ask yourself what the user must understand to decide, and in which
order they can understand it. These principles worked on each page:

- **The start says what the page is.** A short line with the project and the scope, a heading that
  names the topic, and one paragraph: what the page explains, how many questions it asks, and that
  the page saves the answers.
- **Each question is directly below the content that explains it.** Do not collect the questions at
  the end of the page. The user decides while the explanation is fresh.
- **Show more than you tell.** A drawing of the app, a diagram of a sequence or a table of "today"
  and "after the change" frequently explains faster than three paragraphs.
- **The user can ignore the details.** Put code and long lists into `<details>`.
- **The last question asks what you do next.**

A shape that fits a plan for a feature, in this order: the words on this page, the problem and its
cause, the solution with the rejected solutions, what changes for a person, the questions in their
places, the code changes, the next step. `assets/template.html` has this shape.

Other shapes are as good when they fit better. Examples:

- **A comparison of looks.** The page is mostly option cards with mockups, and each card has a short
  text. Use it when the decisions are about what a person sees.
- **The result of a review.** Start with the points of the reviewers and what happened to each one.
  Then ask only about the points that need the user.
- **One decision.** A short page with one explanation and one question is correct when only one
  decision is open. Do not fill it up.
- **A report without questions.** The user reads it and comments on it. The build gives a warning
  that the page has no question, and that is acceptable.
- **Two separate tasks on one page.** Put each task into a `<div class="part">` that starts with a
  `<span class="partname">`.

Use a list of words ("Words on this page") when the page has more than a few special words. The
user reads the page without the context of your session.

## Guidance: the toolbox

The stylesheet has these elements. `assets/template.html` shows the markup of each one. Use the
elements that help, and leave out the others.

| Element | Markup | Good for |
|---|---|---|
| Header | `.eyebrow`, `<h1>`, `.lede`, `nav.toc` | The start of a page. |
| Section | `<section>` with an `<h2>` | One step of the explanation. |
| Table | `<div class="scroll"><table>` | Comparisons, for example "today" and "after the change". The `.scroll` wrapper lets a wide table scroll on a phone. |
| Tag | `<span class="tag new">` | A short mark in a table cell or an option. The classes are `new` (green), `less` (red), `same` (grey), `ask` (amber, points to a question) and `rec` (blue, "recommended"). |
| Diagram | `<figure><div class="scroll"><svg>` | A sequence, a flow of data, a time line, a structure. See "Diagrams" below. |
| Code | `<pre><code class="language-js">` and `<code>` | A sketch of code, and names of files and functions in a sentence. Write `&lt;`, `&gt;` and `&amp;` in code. The build colors a block that names its language: `js`, `cs`, `py`, `sql`, `sh`, `json`, `css` or `html`. |
| Good and cost | `<ul class="pc">` | Below an option: one `<li>` with `<b class="good">Good</b>` and one with `<b class="cost">Cost</b>`, each followed by a `<span>` with a sentence. |
| Option cards | `<div class="choices">` | Options side by side, each with a drawing at the top. See "Mockups". |
| Mockup | `<div class="shot"><div class="mock">` | A drawing of the app. See "Mockups". |
| Flow | `<div class="flow">` | Screens side by side with an arrow between them. See "Mockups". |
| Points | `<div class="points"><article>` | The remarks of a review. Each `<article>` has a `<div>` with an `<h3>` and a `<p>`, and a `<div class="outcome">` with a tag and a sentence that says what happened to the remark. The stylesheet numbers the points. |
| File boxes | `<div class="files">` | The code changes, one box for each area (server, page, tests). |
| Small text | `<p class="note">` | A remark of less importance, for example how you tested something. |
| Box | `<div class="tool">` | A separate block, for example a small tool that the user can try. |
| Folded block | `<details><summary>` | Content that only some readers want. |

### Make what the topic needs

The toolbox is a start. When a different element explains the topic better, write it: a chart of
measured values, a time line, a tree of files, a before and after of one screen, a small tool that
the user can try. Put its styles into a `<style>` of the content file. Three things keep it a part
of the page:

- Use the color variables: `--fg`, `--muted`, `--bg`, `--surface`, `--surface-2`, `--line`,
  `--line-strong`, `--accent`, `--accent-soft`, `--ok`, `--warn`, `--gone`, each with a `-soft`
  variant for the last three. They change with the light and the dark theme.
- Use the fonts: `var(--body)` for text, `var(--display)` for headings, `var(--mono)` for code and
  small labels.
- Examine the element at the width of a phone (390 px). A wide element goes into a `.scroll`.

### Diagrams

Draw a diagram as an inline `<svg>` when the relation between things is the message: which part
sends what to which part, what occurs in which order, where the data is lost. Some suggestions:

- Give the `<svg>` a `viewBox`, `role="img"` and an `aria-label` that says what the diagram shows.
  Add a `<figcaption>` with the source, for example the file and the line.
- Use `fill="currentColor"` for text, and the classes of the stylesheet for shapes: `s-box` (a
  part), `s-ok` (a good state), `s-miss` (a missing or removed thing), `s-arrow`, `s-drop` (a path
  that fails), `s-axis`, and `s-muted`, `s-okt`, `s-gonet` for text. They follow the two themes.
- Write the labels in the diagram in words that the text uses.
- A diagram of more than approximately 760 px scrolls sideways on a phone. That is acceptable for a
  time line. For a simple relation, draw it narrow.

## Guidance: questions

    <fieldset class="ask" data-q="keep-time">
      <legend>How long does a note stay in the trash?</legend>
      <p>The text that the user needs for this decision.</p>
      <label class="opt"><input type="radio" name="keep-time" value="30d"><b>30 days. <span class="tag rec">recommended</span></b><span class="d">The reason for this answer and its result.</span></label>
      <label class="opt"><input type="radio" name="keep-time" value="7d"><b>7 days.</b><span class="d">The result of this answer.</span></label>
      <label class="field"><span class="lab">Your note</span><textarea></textarea></label>
    </fieldset>

- `data-q` is the id of the question. You get it back with the answer.
- The stylesheet numbers the questions, so the `<legend>` has only the text of the question.
- `type="radio"` permits one answer, and `type="checkbox"` permits more than one answer. Tell the
  user in a sentence when more than one answer is possible.
- Below the `<b>` of an option, write one `<span class="d">` with the result of the answer, or a
  `<ul class="pc">` with its good and its cost. The good and the cost help when each answer has a
  clear price.
- A note field in each question is useful. The user frequently wants a variant of an answer.
- Ask about decisions that are open and that the user must make. When something is decided, say
  what you do and why. A heading that ends with "(you do not decide this)" makes that clear.
- When you have a recommendation, mark that option with `<span class="tag rec">recommended</span>`
  and give the reason. The page has a button "Use the recommended answers for the rest". It selects
  the recommended option of each question that has no selection.
- A page with a small quantity of questions gets better answers. When you have more than
  approximately ten, think about which ones you can decide yourself.

## Guidance: mockups

A mockup is a drawing of the app, made with HTML and CSS. Use mockups when an answer changes what a
person sees. The user decides faster from two drawings of the app than from two descriptions.

    <fieldset class="ask" data-q="trash-place">
      <legend>Where does a person open the trash?</legend>
      <div class="choices">
        <label class="opt">
          <div class="shot" aria-hidden="true"><div class="mock n"> ...the drawing... </div></div>
          <input type="radio" name="trash-place" value="tabs"><b>Two tabs below the list. <span class="tag rec">recommended</span></b>
          <ul class="pc">
            <li><b class="good">Good</b><span>The person always sees the trash.</span></li>
            <li><b class="cost">Cost</b><span>The list shows one note less.</span></li>
          </ul>
        </label>
        <label class="opt"> ...the second answer, in the same form... </label>
      </div>
      <label class="field"><span class="lab">Your note</span><textarea></textarea></label>
    </fieldset>

The parts:

- `.choices` puts the option cards side by side. On a phone they go below each other. A tap on a
  drawing selects that option.
- `.shot` is the backdrop of a drawing. Give it `aria-hidden="true"`, and say in the text what the
  drawing shows.
- `.mock` is one drawn screen, or one part of a screen. A `.mock` must be inside a `.shot` or a
  `.cell`, because it measures that element.
- `.flow` shows a sequence of screens: `<div class="cell">` with a `<div class="cap">` caption and a
  `.mock`, then `<div class="arrow">` with the action, then the next `.cell`. Use `class="arrow back"`
  for an arrow that points to the left. A `.flow` goes into a `.shot`.

A mockup can also be outside a question, for example a `.flow` in a `<figure>` that shows the
problem of today.

What makes a drawing useful:

- **It looks like the app.** Read the stylesheet of the app. Use its real colors, font sizes,
  distances and corner sizes. Put the values into CSS variables with a prefix of their own, as the
  template does with `--n-`. Do not use the color variables of the page inside a mockup, because a
  mockup must look the same in the light and the dark theme of the page. When the app has no
  stylesheet yet, say in the text that the drawing is a sketch.
- **It has the correct proportions.** Write each size in `em`. Inside a `.mock`, 1em is 16 px of the
  real app, so 12 px of the app is `0.75em`. Set `--mock-w` to the width of the drawn screen in em.
  A phone of 390 px is `24.4`. The stylesheet makes the drawing smaller when the space is narrow,
  and each size in em follows.
- **Its backdrop fits the app.** Set `--shot-bg` and `--shot-fg` on `:root`. For a dark app, the
  darkest color of the app is a good backdrop.
- **It shows a real state.** Use real names and plausible content from the project. Use the same
  content in each option of one question, so that only the decision is different.
- **It shows only what the decision needs.** A full screen for a flow, one part of the screen for a
  detail.
- **It contains no control and no link.** Draw with `<div>`, `<span>`, `<b>`, `<i>` and inline
  `<svg>`. Draw a field or a button of the app as a `<span>`. This is a part of the contract when
  the drawing is inside a question.
- **The mockup styles of an app are in one file.** Add the file with `build --css=<file>`. Each page
  of the same project then draws the app in the same way. If the project has such a file, use it
  and extend it. If it has none, write the styles into the `<style>` of the content file, and offer
  the user to save them as a file in the project.

## Guidance: the text

The user reads the page cold, frequently on a phone. Write for a person who was not in your session.

- Use plain words, and use one name for one thing on the full page.
- Write complete sentences, also in table cells and below an option. One idea in one sentence.
- Use the active voice and say who does the action: "the server stores the message".
- Do not use names that you invented during the work. Define each special word, or use plain words
  in its place.
- Give specific data: the file and the line, the number that you measured, the date of the test.
- Say what you tested and what nobody tested.
- Do not write a sentence that only announces the next sentence.

## When something fails

- `build` prints an error: the sentence says what to change in the content file.
- `artifact create` says "this page loads from …": the content file loads something from another
  site. Put it into the file.
- The user says that the page does not save: the status bar at the top of the page gives the
  reason. A read link cannot save. Get the edit link again with `artifact links <id>`. If the page
  still does not save, ask the user for the text from "Copy the answers".
- The user sees "Bad Gateway", or the page shows old answers after a reload: the gateway is late.
  The gateway is the web server in the link. It can keep an old copy of the page after a save. The
  answers are safe, because `artifact read` gets the page from the storage servers and not from the
  gateway. Read the answers and tell the user what you have. The same link works on a different
  gateway when you replace the end of the host name, for example `.nsite.lol` with `.nsite.run`.
- The status bar says "A newer version of this page was published": the tab shows an old copy, and
  the page refused to save over the newer answers. The user loads the page again and answers again.
- The user says that an answer "did not stick": two tabs or two persons saved at the same time. The
  second save is refused. Ask the user to load the page again and to answer again.
