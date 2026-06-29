// Unit tests for the pure text-composition logic behind voice dictation.
// The DOM/recognition wiring needs a browser, but composeInsertion — how a
// recognized chunk is spaced and capitalized relative to existing text — is
// pure and is where the subtle behavior lives.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { composeInsertion } from '../js/utils/dictation-text.js';

test('capitalizes the first word in an empty field', () => {
  assert.equal(composeInsertion('', 'hello world'), 'Hello world');
});

test('trims surrounding whitespace from the recognized chunk', () => {
  assert.equal(composeInsertion('', '  hello  '), 'Hello');
});

test('returns empty string for blank input (no spurious insert)', () => {
  assert.equal(composeInsertion('Existing text', '   '), '');
  assert.equal(composeInsertion('', ''), '');
});

test('adds a separating space when appending to existing text', () => {
  assert.equal(composeInsertion('The quick brown', 'fox'), ' fox');
});

test('does not double-space when prior text already ends in whitespace', () => {
  assert.equal(composeInsertion('The quick brown ', 'fox'), 'fox');
});

test('does not capitalize when continuing mid-sentence', () => {
  assert.equal(composeInsertion('The quick brown', 'fox jumps'), ' fox jumps');
});

test('capitalizes after sentence-ending punctuation', () => {
  assert.equal(composeInsertion('All done.', 'next sentence'), ' Next sentence');
  assert.equal(composeInsertion('Really?', 'yes'), ' Yes');
  assert.equal(composeInsertion('Stop!', 'go'), ' Go');
});

test('treats trailing whitespace after punctuation as sentence start', () => {
  assert.equal(composeInsertion('All done. ', 'next'), 'Next');
});

test('mid-caret insertion: before is the text left of the caret', () => {
  // Simulates caret placed right after "brown " when editing existing text.
  assert.equal(composeInsertion('The quick brown ', 'red'), 'red');
});

test('handles null/undefined before gracefully', () => {
  assert.equal(composeInsertion(null, 'hello'), 'Hello');
  assert.equal(composeInsertion(undefined, 'hello'), 'Hello');
});
