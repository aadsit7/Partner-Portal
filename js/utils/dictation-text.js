// ============================================
// Dictation Text Composition (pure helpers)
// ============================================
// Pure, DOM-free string logic shared by field-dictation.js. Kept in its own
// module so it can be unit-tested under Node without importing the browser
// (SpeechRecognition / Quill / voice-widget) machinery.

/**
 * Given the text immediately before the caret and a raw recognized chunk,
 * return the exact string to insert: trimmed, spaced off from preceding
 * text, and capitalized when it begins an empty field or a new sentence.
 *
 * @param {string} before - text to the left of the caret (may be '')
 * @param {string} raw    - raw recognized transcript chunk
 * @returns {string} the string to insert (empty if nothing to add)
 */
export function composeInsertion(before, raw) {
  const text = (raw || '').trim();
  if (!text) return '';

  const prior = before || '';
  const trimmedBefore = prior.replace(/\s+$/, '');
  const atSentenceStart = trimmedBefore === '' || /[.!?]$/.test(trimmedBefore);
  const cased = atSentenceStart ? text.charAt(0).toUpperCase() + text.slice(1) : text;

  const needsSpace = prior.length > 0 && !/\s$/.test(prior);
  return (needsSpace ? ' ' : '') + cased;
}
