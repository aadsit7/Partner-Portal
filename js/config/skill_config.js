// The MAP PDF skill ID. Get this by running:
//   node scripts/upload_recast_map_skill.mjs
// The script will print a line that looks like:
//   Paste this into js/config/skill_config.js: RECAST_MAP_SKILL_ID = 'skill_xxx'
// Replace the placeholder below with the printed value.
//
// This file is committed with a placeholder. The user pastes the real value
// locally after running the upload script. The skill ID is not a credential —
// it identifies an entry in the operator's Anthropic workspace — but we keep
// it out of the public repo so forks don't step on each other.
export const RECAST_MAP_SKILL_ID = 'skill_01Wtozq5wP9bb8HedoYgQ6MV';

// Sentinel — used by runtime code to detect "the user hasn't pasted the ID yet"
// and give a friendly error instead of a 400 from the API.
export const RECAST_MAP_SKILL_ID_PLACEHOLDER = 'PASTE_SKILL_ID_HERE';
