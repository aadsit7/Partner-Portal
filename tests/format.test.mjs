// Tests for the centralized compact-currency formatter used by KPI displays.
import './_setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatCompactCurrency } from '../js/utils/format.js';

test('zero and empty render as $0', () => {
  assert.equal(formatCompactCurrency(0), '$0');
  assert.equal(formatCompactCurrency(''), '$0');
  assert.equal(formatCompactCurrency(null), '$0');
  assert.equal(formatCompactCurrency(undefined), '$0');
  assert.equal(formatCompactCurrency('not a number'), '$0');
});

test('sub-thousand values show whole dollars', () => {
  assert.equal(formatCompactCurrency(500), '$500');
  assert.equal(formatCompactCurrency(999), '$999');
  assert.equal(formatCompactCurrency(1), '$1');
  assert.equal(formatCompactCurrency(499.6), '$500'); // rounds
});

test('thousands use K with trimmed decimals', () => {
  assert.equal(formatCompactCurrency(1000), '$1K');
  assert.equal(formatCompactCurrency(1500), '$1.5K');
  assert.equal(formatCompactCurrency(85000), '$85K');
  assert.equal(formatCompactCurrency(150000), '$150K');
  assert.equal(formatCompactCurrency(12500), '$12.5K');
});

test('millions use M with trimmed decimals', () => {
  assert.equal(formatCompactCurrency(1000000), '$1M');
  assert.equal(formatCompactCurrency(1200000), '$1.2M');
  assert.equal(formatCompactCurrency(2000000), '$2M');
  assert.equal(formatCompactCurrency(1999999), '$2M'); // rounds up across the boundary
});

test('billions and trillions', () => {
  assert.equal(formatCompactCurrency(3200000000), '$3.2B');
  assert.equal(formatCompactCurrency(1000000000000), '$1T');
});

test('strings parse the same as numbers', () => {
  assert.equal(formatCompactCurrency('150000'), '$150K');
  assert.equal(formatCompactCurrency('1200000'), '$1.2M');
});

test('negatives keep the sign', () => {
  assert.equal(formatCompactCurrency(-85000), '-$85K');
  assert.equal(formatCompactCurrency(-500), '-$500');
});
