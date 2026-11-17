# show

An agent skill. The agent makes a web page that explains a topic and asks questions. An answer can
show a mockup, which is a drawing of how the result looks in the user's app. The user answers in the
browser, and the agent reads the answers back.

The look and the structure come from pages that Claude made as artifacts on claude.ai. This project
makes them independent of claude.ai. It publishes through
[nsite-clay](https://github.com/jooray/nsite-clay), so each agent in each sandbox can use it.

## How it works

1. The agent writes a content file. It starts from `assets/template.html`.
2. `page.mjs build` puts the stylesheet, the IBM Plex fonts and the page script into that file. The
   result is one HTML file that loads nothing from another site.
3. The `nsite-artifacts` skill of nsite-clay encrypts the file and publishes it on Nostr relays and
   Blossom servers. It returns a link. The key of the page is the part of the link after `#`.
4. The user opens the link, selects answers and writes notes. The nsite-clay runtime in the page
   saves the full page, with the state of each form control, a few seconds after each change.
5. The agent gets the saved page with `artifact read`, and `page.mjs answers` prints the answers as
   JSON.

No server and no database are necessary. The answers are the form controls of the saved page.

`SKILL.md` has a short contract (the technical rules that saving and reading need) and guidance
(the shape of a page, a toolbox of elements, mockups, the text). The guidance is open to the
judgement of the agent. Only the look is fixed.

## Layout

```text
skills/show/
  SKILL.md               # the steps, the contract, and guidance for the shape, the elements and the text
  assets/template.html   # a complete example page with each element
  assets/page.css        # the look
  assets/page.js         # the status bar, the count of answers, the answers as text
  assets/fonts/          # IBM Plex Sans, Sans Condensed and Mono (latin, latin-ext)
  scripts/page.mjs       # build and answers; plain Node, no dependency
test/page.test.mjs       # node --test
```

## Install

The skill needs Node.js 18 or newer, and network access to the relays and servers that nsite-clay
uses.

Copy the two skill folders into the skills folder of the agent, for example `~/.claude/skills/` or
`<project>/.claude/skills/` for Claude Code:

```bash
git clone https://github.com/urza/show
cp -r show/skills/show ~/.claude/skills/

curl -fsSL -o nsite-artifacts.zip https://nsite-clay.cypherpunk.today/skills/nsite-artifacts.zip
unzip -oq nsite-artifacts.zip -d ~/.claude/skills
```

The link of a page opens through a public gateway. Set the gateway `nsite.run` once, in
`~/.config/nsite-clay/artifacts/config.json`:

```json
{ "gateway": "https://{host}.nsite.run" }
```

The section "Limits" gives the reason.

nsite-artifacts keeps the keys of the published pages in `~/.config/nsite-clay/artifacts/ledger.json`.
Only an agent that has this file can read a page back. Set `NSITE_ARTIFACTS_HOME` to a folder that
survives, if the home folder of the sandbox does not survive.

## Use

Ask the agent to show a topic on a page. By hand:

```bash
node skills/show/scripts/page.mjs build work.html --out=page.html   # --css=mock.css adds the mockup styles of an app
node ~/.claude/skills/nsite-artifacts/scripts/artifact.mjs create page.html --edit=link --expires=14d --gateway='https://{host}.nsite.run'
# ... the user answers ...
node ~/.claude/skills/nsite-artifacts/scripts/artifact.mjs read <id> --as=html --out=saved.html
node skills/show/scripts/page.mjs answers saved.html
```

## Limits

- Each person who has the edit link can change the answers and the page. The link is the key.
- The page is uploaded again on each save. With the fonts, the example page has approximately 230 KB.
- When two tabs save at the same time, the runtime refuses the second save.
- The link opens the page through a public gateway, and a gateway can keep an old copy of the page
  after a save. Measured on 2026-11-17: `nsite.run` served the new version after less than 20
  seconds. `nsite.lol` (the default of nsite-artifacts) answered "Bad Gateway" for more than 20
  minutes. `nsite.cloud` served the old version for more than 2 minutes. The open tab and the
  read-back by the agent do not use the gateway. A reload does. Each gateway is a free service of
  a different operator, without a promise.
- The texts of the status bar are English.

## Test

```bash
node --test
```

## Credits

- [nsite-clay](https://github.com/jooray/nsite-clay) (MIT-0) publishes and saves the pages.
- The fonts are [IBM Plex](https://github.com/IBM/plex), under the SIL Open Font License 1.1
  (`skills/show/assets/fonts/OFL.txt`).
