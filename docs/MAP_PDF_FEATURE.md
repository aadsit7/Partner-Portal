# Randy → MAP PDF Generation

Randy produces Recast-branded Mutual Action Plan PDFs by voice command.
The end-to-end flow lives entirely in the browser and reuses the
existing Google Drive upload path the Opportunity modal already uses.

---

## Architecture

```
  Voice "create a MAP PDF for ANICO"
        │
        ▼
  Randy.detectMapPdfIntent()        ┐
  getOpportunityDescription()       │  unchanged from V1
  (pulls Opportunity_Descriptions)  ┘
        │
        ▼
  requestMapPdfJson()                ← standard Messages API, no Skills,
  (ai.js)                             no Files API, no code_execution
        │  structured JSON
        ▼
  buildMapPdf(json, opportunity)     ← jsPDF + jspdf-autotable
  (map-pdf-builder.js)                in the browser — returns Blob
        │  Blob (application/pdf)
        ▼
  blobToBase64()                     ← readAsDataURL, strip prefix
        │
        ▼
  fileApiRequest({ action:'uploadFile', … })
  (admin-opportunities.js, exported)  ← same Apps Script endpoint
        │                              used by the existing drag-drop
        ▼                              dropzone on the Opp modal
  Google Apps Script → Google Drive
        │  { file: { doc_id, file_name, drive_url, date_added } }
        ▼
  Randy renders success card with "View in Drive" button
  + injects row into the open Opportunity modal's Documents list
```

No backend, no server proxy, no shared credentials beyond what the
browser already holds (the user's Anthropic key and the Apps Script
deployment URL baked into `CONFIG.FILE_API_URL`).

---

## JSON schema Claude returns

`requestMapPdfJson()` hard-codes this schema inline in the prompt so
the model knows exactly what to produce. The browser PDF builder
expects this exact shape — if you change either side, update both:

```json
{
  "customer_name": "American National Insurance Company",
  "document_date": "April 22, 2026",
  "meeting_recap": [
    "Aligned on POC scope across 3 environments (Dev, Test, Prod)",
    "Confirmed delivery target of Q3 for production rollout",
    "…3-6 short bullets total…"
  ],
  "current_environment": {
    "infrastructure":                  [ "…3-5 bullets…" ],
    "current_state_pain":              [ "…3-5 bullets…" ],
    "stakeholders_and_decision_process":[ "…3-5 bullets…" ]
  },
  "mutual_action_plan": [
    { "phase": "Discovery", "action": "…", "owner": "Recast",   "due_date": "2026-04-29", "status": "Complete" },
    { "phase": "POC Setup", "action": "…", "owner": "Customer", "due_date": "2026-05-13", "status": "In Progress" }
  ]
}
```

Rules enforced by the prompt:

- `mutual_action_plan` has 12-16 rows covering Discovery → POC Setup →
  Validation → Business Case → Decision → Rollout.
- Each `status` is one of `Complete | In Progress | Pending | Blocked | Not Started`.
- Dates are ISO `YYYY-MM-DD`.
- `document_date` is the current description date in `Month DD, YYYY` format.
- Empty sections are populated with reasonable inferred entries rather
  than left blank, so the PDF never has empty bullet lists.

Parsing is tolerant: even though the prompt says "no markdown fences",
`parseMapJsonResponse()` strips ```` ```json … ``` ```` fences and
trims leading/trailing prose before `JSON.parse()`.

---

## Filename pattern

`MAP_${slug(customer_name)}_${YYYY-MM-DD}.pdf`

- `slug()` replaces whitespace with `_`, drops non-alphanumerics,
  collapses repeated underscores, trims to 60 chars.
- Date is `document_date` from the JSON, coerced to `YYYY-MM-DD`.
- Example: `MAP_American_National_Insurance_Company_2026-04-22.pdf`

---

## Progress pill

Non-blocking overlay inside the Randy window (bottom-right), stacked
if multiple generations are in flight:

| Stage                    | Trigger                               |
|--------------------------|---------------------------------------|
| `Reading description…`   | pill created                          |
| `Reading description…`   | `requestMapPdfJson()` request fired   |
| `Building PDF…`          | JSON parsed successfully              |
| `Saving to Drive…`       | Drive upload started                  |
| `Saved to {customer}` ✓  | upload succeeded (fades after 3s)     |
| `Failed — see card`      | any error (fades after 5s)            |

- Elapsed timer counts every second from creation: `0:00` → `1:23`.
- At 2:30 the spinner goes amber and the stage switches to
  "Taking longer than expected… still trying".
- Hard failure at 4:00 with `Timed out after 4 minutes`.

Multiple pills stack with 8px gap; pills opt back into pointer events
so the user can interact with them (hover to keep on-screen, etc.).

---

## Voice lines

| Moment  | Phrasing                                                                                         |
|---------|--------------------------------------------------------------------------------------------------|
| Intro   | "On it, boss. Generating the MAP PDF for {customer} now — this will take a few seconds."         |
| Success | "Saved to {customer}, boss. The MAP PDF is in the opportunity's documents — link's in the chat." |
| Failure | "{error-specific}. I couldn't generate the MAP PDF for {customer}, boss. Details are in the chat." |

TTS-before-DOM ordering is preserved: `speakText(...)` fires before
`renderMessage(...)`. Speech only plays when Randy is idle
(ACTIVE_LISTENING / PASSIVE) — if the user started a new task during
generation, the card still appears in the chat, silently.

---

## Success card

Rendered inline in the Randy chat on upload success:

- Left-border accent in Recast green (`#0F7A3F`).
- Title row: green checkmark icon + "MAP PDF Saved".
- Customer name subline.
- Filename in monospace mute.
- Primary CTA: "View in Drive" — opens `drive_url` in a new tab.
- Secondary link: "Open the opportunity to see all its documents →"
  navigates to `/admin/opportunities` and opens the edit modal.

## Failure card

- Left-border accent in amber (`#CC8800`).
- Title row: warning triangle + "Couldn't generate MAP PDF — {customer}".
- User-friendly one-line summary that varies by error code
  (`MAP_JSON_INVALID` / `MAP_JSON_SCHEMA` / `MAP_JSON_API_ERROR` /
  timeout / network / Drive upload).
- Collapsible "Show technical details" with the raw error message.
- "Try again" button — re-runs the whole flow against the same
  opportunity.

---

## Troubleshooting

**"Claude's response didn't parse as the expected JSON"** — usually a
transient model hiccup. Retry. If persistent, check the source
description for extremely unusual content that might be confusing
the schema extraction.

**"Claude's JSON is missing required fields"** — same symptom, same
fix: retry. Each retry uses fresh model inference, so flakes are rare
after one successful retry.

**"API key looks invalid"** — the stored Anthropic key returned 401.
Re-enter it on the Setup page.

**"Drive wouldn't take the upload"** — the Apps Script endpoint
returned an error. Most common cause: the opportunity doesn't yet have
an `opportunity_id` (it was never saved). Save the opportunity first,
then retry.

**"That took too long, boss"** — 2-minute timeout. Usually Anthropic
load. Retry.

**Card appears but no voice** — Randy was mid-task when the flow
finished. The card is still usable; voice is intentionally suppressed
in non-idle states to avoid talking over other speech.

---

## Files involved

| Path                                              | Purpose |
|---------------------------------------------------|---------|
| `js/utils/map-pdf-intent.js`                      | Voice intent detection (unchanged) |
| `js/utils/ai.js` → `requestMapPdfJson()`          | Messages-API call returning structured JSON |
| `js/utils/ai.js` → `getOpportunityDescription()`  | Opportunity lookup + description history (unchanged) |
| `js/utils/map-pdf-builder.js`                     | `buildMapPdf()`, `mapFilename()`, `blobToBase64()` |
| `js/components/map-pdf-pill.js`                   | Progress pill lifecycle helpers |
| `js/components/randy.js`                          | Intent routing, success/failure cards, retry wiring |
| `js/views/admin-opportunities.js`                 | `fileApiRequest` (exported), `addFileToActiveDocsPanel` (exported), refactored `buildDocumentsPanel` returning `{panel, addFile, refresh}` |
| `css/randy.css`                                   | Pill + card styling |
| `css/components.css`                              | `.document-row--just-added` flash |
| `tests/*.test.mjs`                                | `node:test` suite |

### Deprecated but retained

| Path                                     | State | Why kept |
|------------------------------------------|-------|----------|
| `skills/recast-map-pdf/SKILL.md`         | Dormant | Visual reference for the approved PDF layout |
| `skills/recast-map-pdf/reference_map_pdf.py` | Dormant | ReportLab template the jsPDF builder mirrors |
| `skills/recast-map-pdf/example_output_reference.md` | Dormant | Approval reference |
| `scripts/upload_recast_map_skill.mjs`    | Deprecated — header comment | In case a future operator wants to revive a Skills-based flow behind a server proxy |
| `js/config/skill_config.js`              | Empty stub | Import-compat shim; safe to delete once no imports reference it |

---

## V2 roadmap (not in this PR)

- Document types beyond MAP: meeting recap, biweekly update, pre-meeting agenda.
- Persist a structured document record in `Partner_Documents` (currently Apps Script owns all upload metadata).
- "Regenerate" button on the success card (today: delete the old file, re-trigger).
- Visual refinement: logo-in-PDF (requires shipping a logo asset with the static site), personalised architecture page based on the customer's real environment.
