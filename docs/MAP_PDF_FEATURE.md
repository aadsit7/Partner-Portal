# Randy → MAP PDF Generation (V1)

Randy now responds to "create a MAP PDF" voice commands by pulling the
latest dated description from an Opportunity, asking the `recast-map-pdf`
custom skill to produce a 2-page Recast-branded Mutual Action Plan PDF,
and rendering a download button in the chat card.

The entire flow runs in the browser — no backend, no Google Drive, no
server-side storage. The generated PDF is held in memory as a blob URL
for the lifetime of the Randy window.

---

## 1. Initial setup (one-time)

You only do this once per Anthropic workspace.

### 1.1 Install the local tooling

From the repo root:

```bash
npm install
```

That pulls in `@anthropic-ai/sdk`, which the upload script uses. No
other build step — the shipped site is still static files.

### 1.2 Set your Anthropic API key in the shell

```bash
export ANTHROPIC_API_KEY=sk-ant-your-real-key
```

The upload script reads it from `process.env` — it is **never**
written to a file, never logged, and never committed.

### 1.3 Upload the skill

```bash
npm run upload-map-skill
# or, equivalently:
node scripts/upload_recast_map_skill.mjs
```

On first run this creates a new skill named **"Recast MAP PDF"** in
your Anthropic workspace, writes the returned `skill_id` to
`skills/.skill_id` (gitignored), and prints:

```
============================================================
Paste this into js/config/skill_config.js: RECAST_MAP_SKILL_ID = 'skill_xxxxx'
============================================================
```

### 1.4 Paste the skill ID

Open `js/config/skill_config.js` and replace the placeholder:

```js
// before
export const RECAST_MAP_SKILL_ID = 'PASTE_SKILL_ID_HERE';

// after
export const RECAST_MAP_SKILL_ID = 'skill_01ABCxyz...';  // <- your real ID
```

Commit and push this change. The skill ID is not a credential — it
simply identifies your skill inside your Anthropic workspace — but
it is still specific to your workspace, so we keep the committed
value as a placeholder in the public repo.

### 1.5 Verify

Open the portal, open Randy, and say:

> "Randy, create a MAP PDF for ANICO"

(substituting one of your real opportunity names). Randy should say
"On it, boss…" and, about 30–90 seconds later, render a card with a
blue **Download PDF** button.

---

## 2. Updating the skill later

Whenever any of these change:

- `skills/recast-map-pdf/SKILL.md`
- `skills/recast-map-pdf/reference_map_pdf.py`
- `skills/recast-map-pdf/example_output_reference.md`

…re-run the upload script:

```bash
export ANTHROPIC_API_KEY=sk-ant-your-real-key
npm run upload-map-skill
```

Because `skills/.skill_id` already exists, the script **publishes a
new version of the same skill** instead of creating a fresh one.
Output looks like:

```
[upload-skill] Existing skill ID: skill_01ABCxyz...
[upload-skill] Publishing a new version…
[upload-skill] Published new version: 3
```

No change needed in `js/config/skill_config.js` — the skill ID stays
the same, and the request payload specifies `version: 'latest'` so
every client picks up the new version automatically.

---

## 3. Trigger phrases Randy recognises

Case-insensitive; all forms below fire the MAP flow:

| Phrase | Example |
|---|---|
| create a map / create a map pdf | "Randy, create a MAP PDF for ANICO" |
| generate a map / generate a mutual action plan | "Generate a MAP for American National" |
| build a map / build a map pdf | "Build a MAP PDF on the ANICO opportunity" |
| make me a map pdf | "Can you make me a MAP PDF for the PSE deal?" |
| new map / new map pdf | "New MAP for Fabrikam" |
| update the map / update map pdf | "Update the MAP for ANICO" |
| mutual action plan pdf | "Mutual action plan PDF for HCA" |
| meeting recap pdf | "Meeting recap PDF for Fabrikam" |

Randy extracts the opportunity name from `for <X>` or `on <X>`
clauses; trailing qualifiers like "deal", "opportunity", "account",
"now", "please" are stripped automatically.

If you leave the opportunity out ("create a MAP PDF") Randy asks
"Which opportunity should I pull the MAP from, boss?" and uses your
next message as the hint.

---

## 4. Example conversation flow

```
You: Randy, create a MAP PDF for ANICO.
Randy: On it, boss. Generating the MAP PDF for
       American National Insurance Company now —
       this will take a few seconds.

  [Randy transitions back to listening — you can do other things.]

  [30-90 seconds later]

Randy: Your MAP PDF for American National Insurance Company is
       ready, boss. Click the download button to save it.

  [A card appears in Randy's chat:
     "MAP PDF Ready — American National Insurance Company"
     [ Download PDF ]
     recast-map-american-national-insurance-company-2026-04-22.pdf
  ]
```

If Randy finds 2+ opportunities matching your hint, he lists them and
asks which one. Your next message becomes the pick.

If Randy is mid-task when the PDF finishes (you started a new
question, he's speaking a different answer, etc.), the download card
still appears in the chat silently — no spoken interrupt — so the
PDF is never lost.

---

## 5. Name matching — how Randy resolves your hint

Three passes, first hit wins:

1. **Exact** case-insensitive match on `customer_name` or `deal_name`.
2. **Partial** substring match on either field.
3. **Acronym** match: first letter of each word in `customer_name` /
   `deal_name`, compared against your hint. "ANICO" → acronym "ANIC"
   of "American National Insurance Company" → match.

If pass 3 returns more than one, Randy asks you to pick. If all
three return zero, Randy says "I couldn't find that opportunity in
the sheet, boss."

---

## 6. What content goes into the MAP?

Randy pulls from the **`Opportunity_Descriptions`** sheet (not the
summary field on the `Opportunities` sheet itself). Specifically:

- The **newest** description entry (by `description_date`) becomes
  the primary content — this is the meeting the MAP is generated from.
- Up to **5 prior entries** are included as context for the skill's
  internal P.C.P. analysis step.

If an opportunity has zero rows in `Opportunity_Descriptions`, Randy
refuses with:

> "No meeting descriptions found for {name} yet, boss. I need at
> least one description entry in the Opportunity_Descriptions sheet
> before I can generate a MAP."

This is intentional — the `Opportunities.description` summary cell
and the `Opportunities.notes` JSON are not structured as meeting
content and would produce a poor MAP.

---

## 7. Troubleshooting

### "The MAP skill isn't set up yet, boss."
`js/config/skill_config.js` still has the placeholder. Run
`npm run upload-map-skill` and paste the printed skill ID in,
then reload the portal.

### "I hit a snag with the MAP skill, boss."
The API returned a 400 mentioning the skill. Usually means the
skill was deleted in the Anthropic console, or the files on disk
don't match what was last uploaded. Fix: re-run
`npm run upload-map-skill` — it publishes a new version against
the existing `skills/.skill_id`.

### "That's taking too long, boss."
The request exceeded the 2-minute timeout. Try again — Anthropic's
sandbox is occasionally slow under load. If it keeps happening,
simplify the description text (very long histories take longer to
process).

### "The PDF was generated but I couldn't download it, boss."
The `/v1/files/{id}/content` call failed. Open the browser console
to see the HTTP status. Most common cause: the API key doesn't have
Files API access — check your Anthropic plan.

### "I couldn't find that opportunity in the sheet, boss."
Randy tried exact, partial, and acronym matching and came up empty.
Read off the exact `customer_name` or `deal_name` as it appears in
the `Opportunities` sheet.

### Nothing happens / regular chat flow runs instead
The trigger phrase didn't match. Check `js/utils/map-pdf-intent.js`
— the patterns are narrow on purpose (to avoid false-positives on
"show me on a map"). "create a MAP PDF" / "generate a MAP" /
"update the MAP" always trigger.

---

## 8. Files involved

| Path | Purpose |
|---|---|
| `skills/recast-map-pdf/SKILL.md` | Skill definition (read-only asset) |
| `skills/recast-map-pdf/reference_map_pdf.py` | Layout template for the skill |
| `skills/recast-map-pdf/example_output_reference.md` | Visual QA reference |
| `scripts/upload_recast_map_skill.mjs` | One-shot uploader / versioner |
| `js/config/skill_config.js` | Holds `RECAST_MAP_SKILL_ID` |
| `js/utils/map-pdf-intent.js` | `detectMapPdfIntent()` regex matcher |
| `js/utils/ai.js` → `getOpportunityDescription()` | Looks up the opportunity + dated history |
| `js/utils/ai.js` → `callClaudePdfGeneration()` | Non-streaming Claude call w/ code_execution |
| `js/components/randy.js` → `runMapPdfFlow()` | Orchestrates the voice conversation |
| `css/randy.css` → `.randy-map-card` | Download card styling |
| `tests/*.test.mjs` | Node's built-in test runner |

---

## 9. V2 roadmap (out of scope for V1)

- Google Drive upload + shareable link alongside the browser download
- Document types 1, 3, 4 (meeting recap / biweekly update / pre-meeting agenda)
- Persist generated PDFs against the Opportunity in a new
  `Opportunity_Documents` sheet
- Retry-with-simplification when generation times out
- Operator-visible "regenerate" button on the download card
