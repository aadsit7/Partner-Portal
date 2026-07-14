// Tests for the pure global-search matcher (searchEntities). Imports the
// function in isolation — it has no DOM dependency.
import './_setup.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { searchEntities } from '../js/components/global-search.js';

const DATA = {
  partners: [
    { partner_id: 'p1', display_name: 'Nerdio', partner_type: 'Technology', tier: 'Premier/Strategic' },
    { partner_id: 'p2', display_name: 'RidgePoint', partner_type: 'MSP/SI', tier: 'Value/Preferred' },
    { partner_id: 'p3', display_name: 'Insight', partner_type: 'MSP/SI', tier: 'Premier/Strategic' },
  ],
  opportunities: [
    { opportunity_id: 'o1', deal_name: 'Azure Virtual Desktop Rollout', customer_name: 'TechCorp Industries', deal_value: '150000' },
    { opportunity_id: 'o2', deal_name: 'Cloud Desktop Optimization', customer_name: 'Metro Health Systems', deal_value: '85000' },
    { opportunity_id: 'o3', deal_name: 'Managed Services Engagement', customer_name: 'TechCorp Industries', deal_value: '200000' },
  ],
};

test('empty query returns empty groups', () => {
  const r = searchEntities('', DATA);
  assert.deepEqual(r, { deals: [], partners: [], customers: [] });
  assert.deepEqual(searchEntities('   ', DATA).deals, []);
});

test('matches deals by deal_name (case-insensitive)', () => {
  const r = searchEntities('azure', DATA);
  assert.equal(r.deals.length, 1);
  assert.equal(r.deals[0].opportunity_id, 'o1');
});

test('matches deals by customer_name', () => {
  const r = searchEntities('techcorp', DATA);
  assert.equal(r.deals.length, 2);
});

test('matches partners by display_name', () => {
  const r = searchEntities('ridge', DATA);
  assert.equal(r.partners.length, 1);
  assert.equal(r.partners[0].partner_id, 'p2');
});

test('customers are de-duplicated across opportunities', () => {
  const r = searchEntities('techcorp', DATA);
  assert.equal(r.customers.length, 1);
  assert.equal(r.customers[0].customer_name, 'TechCorp Industries');
});

test('no matches returns all-empty groups', () => {
  const r = searchEntities('zzzznope', DATA);
  assert.equal(r.deals.length + r.partners.length + r.customers.length, 0);
});

test('respects per-group limit', () => {
  const many = { opportunities: [], partners: [] };
  for (let i = 0; i < 20; i++) {
    many.opportunities.push({ opportunity_id: 'x' + i, deal_name: 'Deal ' + i, customer_name: 'Cust ' + i });
    many.partners.push({ partner_id: 'p' + i, display_name: 'Partner ' + i });
  }
  const r = searchEntities('deal', many, 6);
  assert.equal(r.deals.length, 6);
  const r2 = searchEntities('partner', many, 3);
  assert.equal(r2.partners.length, 3);
});

test('handles rows with missing fields without throwing', () => {
  const data = { opportunities: [{ opportunity_id: 'o' }], partners: [{ partner_id: 'p' }] };
  const r = searchEntities('anything', data);
  assert.deepEqual(r, { deals: [], partners: [], customers: [] });
});
