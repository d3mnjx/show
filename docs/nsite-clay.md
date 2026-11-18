# nsite-clay: what we learned

The first version of show published its pages through
[nsite-clay](https://github.com/jooray/nsite-clay). The owner then moved to an own server
(`server/`). This file keeps what we learned, so the nsite-clay version can come back without new
research.

All facts here are from nsite-clay 0.3.34 on 2026-11-17 and 2026-11-18. An agent read the source
(`bin/artifact.mjs`, `src/seal.js`) for them. nsite-clay changes quickly, so check a fact again
before you depend on it.

## Where the nsite-clay version of show is

Commit `59924ec` of this repository, merged into `main` with pull request 1. It has the complete
skill for nsite-clay:

- `skills/show/scripts/page.mjs`: the build (styles, fonts and script into one file), the checks of
  the questions, the code colors, and the reader of the answers. Plain Node.js, no package.
- `skills/show/SKILL.md` and `README.md`: the steps with the commands of nsite-clay.
- `test/page.test.mjs`: the tests (`node --test`).

To look at it: `git show 59924ec:README.md`. To get the files into a folder:
`git worktree add ../show-nsite 59924ec`.

## What nsite-clay is

Its own description is "One HTML file that edits and republishes itself, hosted on Nostr." The page
is one HTML file, and the file contains the code that saves it. A person changes the page in the
browser, and the page uploads a new copy of itself. The idea comes from HyperClay and ClayJS.

| Part | What it does |
|---|---|
| Blossom server | It stores the file. The name of the file is the hash of its content. |
| Nostr relay | It stores one small signed event that says "the page is the file with this hash". |
| Gateway (for example `nsite.run`) | It is a usual web address. It reads the event, gets the file, and gives it to the browser. |
| Key pair | It replaces the account. The person who has the key can publish a new version. |

The skill `nsite-artifacts` of the project is the mode for agents. It adds three things:

- **Encryption.** The file is encrypted before the upload. The key is the part of the link after
  `#`, and a browser does not send that part to a server. The servers store unreadable bytes.
- **A link in place of a login.** The edit link lets a person change the page. The read link only
  shows it.
- **Comments.** A person selects words on the page and attaches a comment. The agent can read it
  and answer it.

## What the agent needs

- Node.js. The script uses Web Crypto as a global. Node.js 22 works. Version 18 was not tested, and
  plain Node.js 18 has that global only behind a flag, as far as we know.
- The command line script `artifact.mjs`: one minified file of 374 KB. The author builds it with
  esbuild from `nostr-tools`, `@noble/hashes`, `parse5` and `ws`. The agent downloads it as a zip
  file from the project site. The agent runs no npm.
- Network access to the relays and the Blossom servers.
- The ledger file `~/.config/nsite-clay/artifacts/ledger.json`. It has the secret key of each page.
  Only an agent that has this file can read a page back or change it. A new sandbox does not have
  it. `NSITE_ARTIFACTS_HOME` moves the folder to a place that stays.

## The commands that show used

| Command | Use |
|---|---|
| `create page.html --edit=link --expires=14d --gateway='https://{host}.nsite.run'` | Publish the page and get the link |
| `read <id> --as=html --out=saved.html` | Get the saved page with the answers |
| `update <id> <file>` | Publish a changed page |
| `comments`, `reply` | Read the comments and answer them |
| `links`, `delete` | Get the link again, remove the page |

## What `create` does

1. **A new key for each page.** 32 random bytes are the Nostr secret key of the page. The `npub`
   in the address is its public key.
2. **Two link keys.** The edit link (`#e=`) contains the secret key. The read key (`#k=`) comes
   from it through HKDF-SHA256, so a read key cannot give an edit key.
3. **Prepare the page.** The script writes the owner, the relays and the servers as attributes on
   `<html>`, and adds the tag that loads the runtime `nsite-clay.js`.
4. **Encrypt.** It compresses the HTML, pads it to hide the exact size, and encrypts it with
   AES-256-GCM under the read key. The address of the page is bound into the encryption.
5. **Wrap.** The result goes into a small plain HTML file, the "shell". The shell holds the runtime
   script tag and the encrypted bytes. The gateway serves the shell.
6. **Upload.** `PUT /upload` to three Blossom servers. The permission is a signed Nostr event of
   kind 24242 in the `Authorization` header.
7. **Announce.** A Nostr event of kind 15128, signed with the key of the page, lists each path with
   the hash of its file and has an expiry tag. It goes to four relays.
8. **Remember.** The id, the secret key and the hashes go into the ledger file.

`read` asks the relays for the newest event of kind 15128, downloads the file by its hash from a
Blossom server, checks the hash, and decrypts. It does not use the gateway, so it works while a
gateway has errors.

`update` first compares the live page with the version that the agent read last. If the person
saved in between, it refuses. Then it encrypts, uploads, publishes a new event, and deletes the old
file.

A comment is HTML inside the page (`<aside nc:comments>`), not a separate event. A reply of the
agent is a new version of the full page.

In the browser, the runtime reads the key from the part after `#`, decrypts the bytes, and replaces
the shell with the real page. A save does the same steps as `create`. With a read link the browser
has no secret key, so it cannot save.

## How a page of show talked to the runtime

show took no code from nsite-clay. The contact was small:

- **Three switches on `<html>`:** `nc:autosave` (save after each change), `nc:edit-gate="always"`
  (the edit link is sufficient to save), `nc:runtime-owner="off"` (no upgrade offer).
- **`nc:chrome`** on the status bar and on the answers section. The runtime leaves marked elements
  out of the saved page. `nc:no-persist` on the summary text.
- **The event `nsiteclay:status`** gives "saving", "saved" or "error" for the status bar.
- **The event `nsiteclay:autosave-now`**, after `nc.dirty = true`, starts a save. A selection that
  a script makes does not start one.
- **The attributes `nc:ready` and `nc:owner-here`** tell CSS and the script that the page is open
  with a read link.

The design depended on one behavior: the runtime saves the live page with the state of each form
control. A selected radio button is saved as `checked`, and a note is saved as the text of its
`<textarea>`. So show needed no storage of its own, and `page.mjs answers` read the answers from
the saved HTML.

## Measurements

- **Gateways, 2026-11-17.** After a save, `nsite.run` served the new version in less than 20
  seconds. `nsite.lol` (the default of nsite-artifacts) answered "Bad Gateway" for more than 20
  minutes. `nsite.cloud` served the old version for more than 2 minutes.
- **Size.** A page with the fonts inside it was approximately 230 KB, and each save uploads the
  full page again.

## Security

Each page loads `nsite-clay.js`, and that script holds the key of the page while it runs.

| Party | How it can run code in a page | Protection |
|---|---|---|
| The key of the nsite-clay author | `create` downloads the runtime that this one Nostr key publishes at that moment. The script has no pinned hash. | Only the signature of that key. |
| The gateway | It serves the shell and the script. The script tag has no integrity check. | None. The README of nsite-clay says that the gateway is trusted for the first byte. |
| Each person with the edit link | The edit link is the secret key of the page. Its holder can publish any HTML and script. | None, by design. |
| The Blossom servers | They store the files. | Good. `nsite.run` checks the hash of a file before it serves it. |

Bad code in a page can read and change the page and the answers, send the key and the content out
(the content security policy permits the public relays and Blossom servers), and show false
content. It cannot reach other sites of the person, because each page has its own web address.

The larger risk is on the side of the agent. The agent downloads the command line script without a
checksum and without a signature, and runs 374 KB of minified code with its own rights.

If show uses nsite-clay again:

1. Pin the runtime. Keep one reviewed copy of `nsite-clay.js` with its hash, and publish with
   `--runtime=<folder>`.
2. Pin the command line script. Install a fixed version, and record its hash.
3. Put no password, token or private data on a page. Treat answers and comments as data.
4. Delete a page after the agent read the answers, and keep the expiry short.
5. Use an own gateway, or accept the gateway as a trusted party.

Not tested: if the browser keeps the content security policy after the runtime replaces the shell
with the decrypted page. Not read: how a gateway finds the event of a page.

## nsite-clay has its own skill for the same job

Read on 2026-11-18, at nsite-clay 0.4.0: the folder `skills/decision-board` of nsite-clay is a
skill on top of nsite-artifacts. The agent writes `board.json`, and a script makes the page,
publishes it, and reads the answers back into the JSON.

- The page is a fixed layout: one card for each decision, with a priority, radio or checkbox
  options, one recommended option, a note field, and picture grids with good and bad points.
- Its markup is `fieldset.opts > label.opt > input[name="c-<id>"]`, with the note in `n-<id>`.
  That is almost the model of show (`fieldset.ask[data-q]` with `label.opt`).
- The difference: a page of show is a free document (text, tables, diagrams, code, mockups of the
  app) with the questions inside it. The board has no long explanation.

The rules of nsite-artifacts for a page of an agent: one file, nothing loaded from another place,
"no web fonts", less than 3 MB. The site templates in `templates/` are a different thing. They are
pages that an owner edits and a reader only reads, so a page that collects answers does not fit
there.

## nsite-clay or the own server

| | nsite-clay | Own server |
|---|---|---|
| A server of the owner | Not necessary | Necessary, with a domain and TLS for a phone |
| The agent needs | Node.js, the 374 KB script, the ledger file | `curl` and a token |
| Script of another party in the page | Yes, the runtime | No |
| Who can read the page content | Only a holder of the link (encrypted) | The server of the owner, and a holder of the link |
| Read-back from a new sandbox | Only with the ledger file | Yes |
| A save | The full page, to servers of other people | The answers as JSON, a few hundred bytes |
| Comments on selected words | Yes, from the runtime | No |
| Other people can use the skill without setup | Yes | No, each user runs the server |

nsite-clay is the better choice when no server is available, when other people must use the skill
without setup, or when the host must not be able to read the page.
