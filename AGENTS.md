# show: rules for agents that change this project

Read `README.md` first. It explains how the parts work together.

- **No dependency and no build step for the skill.** `scripts/page.mjs` uses only the modules of
  Node.js. An agent copies the skill folder and runs it. Do not add a `package.json` dependency.
- **The page script stores nothing.** The answers are the form controls of the page, and the
  nsite-clay runtime saves the page. `assets/page.js` only reads the form. Each element that it adds
  needs the attribute `nc:chrome`, or the runtime saves that element into the page.
- **Do not let a script set a class or an attribute on the content.** The runtime saves the live
  markup, so such a change becomes a part of the page. Show state with CSS selectors such as
  `:has(input:checked)`.
- **`SKILL.md` separates the contract from the guidance.** The owner wants the skill open to the
  judgement of the agent. Put a rule into "The contract" only when the page breaks without it.
  Write all other content as guidance with its reason, not as an order.
- **`assets/template.html` is the catalog of the elements.** When you add an element to
  `assets/page.css`, add an example to the template and one row to the table in `SKILL.md`.
- **`build` checks what `answers` reads.** Both use the function `questions` in `scripts/page.mjs`.
  When you permit new markup in a question, add a test with the saved form of that markup.
- **Plain words.** Write `SKILL.md`, the template, the error messages and the texts of the status
  bar in short, complete sentences in the active voice.
- Run `node --test` before each commit.
- `upstream` (https://github.com/urza/show) is the stable repository. `origin`
  (https://github.com/d3mnjx/show) is the fork where the work happens. Push a branch to `origin`
  and open the pull request on `urza/show`:
  `gh pr create --repo urza/show --head d3mnjx:<branch>`.
- The publish and read commands belong to the nsite-artifacts skill of
  https://github.com/jooray/nsite-clay. Do not copy its script into this project.
