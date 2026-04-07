// ============================================
// Admin Partner Detail View
// ============================================

import { readSheetAsObjects, appendRow, updateRow, deleteRow, isConfigured, addDemoRow, updateDemoRow, deleteDemoRow } from '../sheets.js';
import { CONFIG } from '../config.js';
import { el, mount, formatCurrency, uuid } from '../utils/dom.js';
import { formatDate, todayISO, nowISO } from '../utils/date.js';
import { navigate } from '../router.js';
import { tierSlug, TIER_ICONS } from '../utils/tiers.js';
import { dealCard, statCard } from '../components/card.js';
import { openModal, closeModal, confirmDialog } from '../components/modal.js';
import { openEventModal } from './admin-events.js';
import { openOppModal } from './admin-opportunities.js';
import { setTopbarTitle } from '../components/sidebar.js';
import { showToast } from '../components/toast.js';
import { filterOpportunities, filterEvents } from '../utils/filters.js';

export const title = 'Partner Detail';

export async function render(container, params) {
  const partnerId = params?.id;

  if (!partnerId) {
    navigate('/admin/dashboard');
    return;
  }

  setTopbarTitle('Partner Detail');
  mount(container, el('div', { class: 'loading-overlay' }, el('div', { class: 'spinner' })));

  try {
    const [partners, opportunities, events, transcripts] = await Promise.all([
      readSheetAsObjects(CONFIG.SHEET_PARTNERS),
      readSheetAsObjects(CONFIG.SHEET_OPPORTUNITIES),
      readSheetAsObjects(CONFIG.SHEET_EVENTS),
      readSheetAsObjects(CONFIG.SHEET_TRANSCRIPTS),
    ]);

    const partner = partners.find(p => p.partner_id === partnerId);
    if (!partner) {
      mount(container, el('div', { class: 'empty-state' },
        el('div', { class: 'empty-state__title' }, 'Partner not found'),
        el('button', { class: 'btn btn--primary', onClick: () => navigate('/admin/dashboard') }, 'Back to Dashboard')
      ));
      return;
    }

    const partnerOpps = filterOpportunities(opportunities).filter(o => o.partner_id === partnerId);
    const partnerEvents = filterEvents(events).filter(e => !e.partner_id || e.partner_id === partnerId);
    const partnerTranscripts = transcripts
      .filter(t => t.partner_id === partnerId)
      .sort((a, b) => new Date(b.conversation_date || b.created_at) - new Date(a.conversation_date || a.created_at));

    renderDetail(container, partner, partnerOpps, partnerEvents, partnerTranscripts);
  } catch (err) {
    mount(container, el('div', { class: 'empty-state' },
      el('div', { class: 'empty-state__title' }, 'Error loading data'),
      el('div', { class: 'empty-state__description' }, err.message)
    ));
  }
}

function reRender(partnerId) {
  const viewContainer = document.getElementById('view-container');
  render(viewContainer, { id: partnerId });
}

function renderDetail(container, partner, opportunities, partnerEvents, transcripts) {
  const tierClass = tierSlug(partner.tier);
  const totalValue = opportunities.reduce((s, o) => s + (parseFloat(o.deal_value) || 0), 0);
  const wonDeals = opportunities.filter(o => o.status === 'Won');
  const wonValue = wonDeals.reduce((s, o) => s + (parseFloat(o.deal_value) || 0), 0);
  const sortedEvents = [...partnerEvents].sort((a, b) => new Date(b.event_date) - new Date(a.event_date));

  const content = el('div', {},
    // Back button
    el('a', {
      class: 'back-link',
      href: '#/admin/dashboard',
      onClick: (e) => { e.preventDefault(); navigate('/admin/dashboard'); }
    },
      el('span', { html: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' }),
      'Dashboard'
    ),

    // Partner header — split screen layout
    el('div', { class: 'detail-header-wrapper' },
      el('div', { class: 'detail-header' },
        el('div', { class: `partner-avatar partner-avatar--${tierClass}` },
          (partner.display_name || '').split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase() || '?'
        ),
        el('div', { class: 'detail-header__info' },
          el('div', { style: { display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-2)' } },
            el('h2', { class: 'detail-header__name' }, partner.display_name),
            el('span', { class: `badge badge--${tierClass}` },
              el('span', { class: 'badge__icon', html: TIER_ICONS[tierClass] || '' }),
              partner.tier
            )
          ),
          el('div', { class: 'detail-header__meta' },
            partner.partner_type ? el('span', { class: 'detail-header__meta-item' }, partner.partner_type) : null,
            partner.region ? el('span', { class: 'detail-header__meta-item' }, partner.region) : null,
            partner.hq_location ? el('span', { class: 'detail-header__meta-item' }, partner.hq_location) : null
          )
        ),
        el('div', { class: 'detail-header__stats' },
          el('div', { class: 'detail-header__stat' },
            el('div', { class: 'detail-header__stat-value' }, String(opportunities.length)),
            el('div', { class: 'detail-header__stat-label' }, 'Deals')
          ),
          el('div', { class: 'detail-header__stat' },
            el('div', { class: 'detail-header__stat-value' }, formatCurrency(totalValue)),
            el('div', { class: 'detail-header__stat-label' }, 'Pipeline')
          ),
          el('div', { class: 'detail-header__stat' },
            el('div', { class: 'detail-header__stat-value' }, formatCurrency(wonValue)),
            el('div', { class: 'detail-header__stat-label' }, 'Won')
          ),
        )
      ),
      el('div', { class: 'detail-header-chart' },
        buildPartnerRevenueByEvent(partnerEvents, opportunities)
      )
    ),

    // Section 1: Upcoming Joint Events — compact consolidated view
    buildUpcomingEventsSection(sortedEvents, partner, container),

    // Section 2: Opportunities
    el('div', { class: 'detail-section' },
      el('div', { class: 'detail-section__header' },
        el('h3', { class: 'detail-section__title' }, `Opportunities (${opportunities.length})`),
        el('button', {
          class: 'btn btn--primary btn--sm',
          onClick: () => {
            openOppModal(null, null, () => reRender(partner.partner_id));
            setTimeout(() => {
              const sel = document.querySelector('#field-partner_id');
              if (sel) { sel.value = partner.partner_id; }
            }, 50);
          },
        },
          el('span', { html: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' }),
          'New Opportunity'
        )
      ),

      el('div', { class: 'stats-grid stagger', style: { marginBottom: 'var(--space-6)' } },
        statCard('Total Deals', opportunities.length),
        statCard('Active Pipeline', formatCurrency(totalValue)),
        statCard('Deals Won', wonDeals.length),
        statCard('Revenue Won', formatCurrency(wonValue))
      ),

      opportunities.length > 0
        ? el('div', { class: 'card-grid stagger' },
            ...opportunities.map(opp => dealCard(opp, {
              onEdit: (o) => openOppModal(o, null, () => reRender(partner.partner_id)),
            }))
          )
        : el('div', { class: 'empty-state', style: { padding: 'var(--space-8) var(--space-4)' } },
            el('div', { class: 'empty-state__title' }, 'No deals registered'),
            el('div', { class: 'empty-state__description' }, 'Click "New Opportunity" to add a deal for this partner.')
          )
    ),

    // Section 3: Call Transcripts
    el('div', { class: 'detail-section' },
      el('div', { class: 'detail-section__header' },
        el('h3', { class: 'detail-section__title' }, 'Call Transcripts'),
        el('div', { style: { display: 'flex', gap: 'var(--space-2)' } },
          transcripts.length > 0
            ? el('button', {
                class: 'btn btn--secondary btn--sm',
                onClick: () => downloadAllTranscriptsPDF(partner, transcripts),
              }, 'Export All PDF')
            : null,
          el('button', {
            class: 'btn btn--primary btn--sm',
            onClick: () => openTranscriptModal(partner, null, transcripts, () => reRender(partner.partner_id)),
          },
            el('span', { html: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' }),
            'Add Transcript'
          ),
        )
      ),
      transcripts.length > 0
        ? el('div', { class: 'transcript-list' },
            ...transcripts.map(t => transcriptCard(t, partner))
          )
        : el('div', { class: 'empty-state', style: { padding: 'var(--space-8) var(--space-4)' } },
            el('div', { class: 'empty-state__title' }, 'No transcripts yet'),
            el('div', { class: 'empty-state__description' }, 'Click "Add Transcript" to log a call with this partner.')
          )
    ),
  );

  mount(container, content);
}

// ============================================
// Transcript Components
// ============================================

function transcriptCard(transcript, partner) {
  const dateStr = formatDate(transcript.conversation_date) || formatDate(transcript.created_at);
  const preview = (transcript.transcript_text || '').slice(0, 120) + ((transcript.transcript_text || '').length > 120 ? '...' : '');

  const toggleIcon = el('span', {
    class: 'transcript-card__toggle',
    html: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  });

  const body = el('div', { class: 'transcript-card__body' },
    el('div', { class: 'transcript-card__text' }, transcript.transcript_text || ''),
    el('div', { class: 'transcript-card__actions' },
      el('button', {
        class: 'btn btn--ghost btn--sm',
        onClick: (e) => { e.stopPropagation(); copyTranscriptText(transcript); },
      }, 'Copy Text'),
      el('button', {
        class: 'btn btn--ghost btn--sm',
        onClick: (e) => { e.stopPropagation(); downloadTranscriptPDF(transcript); },
      }, 'Download PDF'),
      el('button', {
        class: 'btn btn--ghost btn--sm',
        onClick: (e) => {
          e.stopPropagation();
          openTranscriptModal(partner, transcript, [], () => reRender(partner.partner_id));
        },
      }, 'Edit'),
      el('button', {
        class: 'btn btn--ghost btn--sm',
        style: { color: 'var(--color-danger)' },
        onClick: (e) => { e.stopPropagation(); handleDeleteTranscript(transcript, partner); },
      }, 'Delete'),
    )
  );

  const header = el('div', { class: 'transcript-card__header', onClick: () => {
    const isOpen = body.classList.toggle('transcript-card__body--open');
    toggleIcon.classList.toggle('transcript-card__toggle--open', isOpen);
  }},
    el('span', { class: 'transcript-card__date' }, dateStr),
    el('span', { class: 'transcript-card__preview' }, preview),
    toggleIcon
  );

  return el('div', { class: 'transcript-card' }, header, body);
}

function openTranscriptModal(partner, existingTranscript, previousTranscripts, onSaved) {
  const isEdit = !!existingTranscript;

  const dateInput = el('input', {
    class: 'form-input',
    type: 'date',
    id: 'transcript-date',
    value: isEdit ? (existingTranscript.conversation_date || '') : todayISO(),
  });

  const textArea = el('textarea', {
    class: 'form-textarea',
    id: 'transcript-text',
    placeholder: 'Paste or type the call transcript here...',
    style: { minHeight: '200px' },
    value: isEdit ? (existingTranscript.transcript_text || '') : '',
  });
  // textarea value must be set after creation
  if (isEdit && existingTranscript.transcript_text) {
    textArea.value = existingTranscript.transcript_text;
  }

  const formContent = el('div', {},
    el('div', { class: 'form-group' },
      el('label', { class: 'form-label' }, 'Partner'),
      el('input', {
        class: 'form-input',
        type: 'text',
        value: partner.display_name,
        readOnly: true,
        style: { background: 'var(--color-bg)', cursor: 'default' },
      })
    ),
    el('div', { class: 'form-group' },
      el('label', { class: 'form-label' }, 'Conversation Date'),
      dateInput
    ),
    el('div', { class: 'form-group' },
      el('label', { class: 'form-label' }, 'Transcript'),
      textArea
    ),
  );

  // Show previous transcripts for reference (only in add mode)
  if (!isEdit && previousTranscripts && previousTranscripts.length > 0) {
    const historySection = el('div', { class: 'transcript-form__history' },
      el('div', { class: 'transcript-form__history-title' }, `Previous Transcripts (${previousTranscripts.length})`),
      ...previousTranscripts.slice(0, 5).map(t =>
        el('div', { class: 'transcript-form__history-item' },
          el('div', { class: 'transcript-form__history-date' }, formatDate(t.conversation_date) || formatDate(t.created_at)),
          el('div', { class: 'transcript-form__history-preview' },
            (t.transcript_text || '').slice(0, 200) + ((t.transcript_text || '').length > 200 ? '...' : '')
          )
        )
      )
    );
    formContent.appendChild(historySection);
  }

  const saveBtn = el('button', {
    class: 'btn btn--primary',
    onClick: async () => {
      const date = dateInput.value;
      const text = textArea.value.trim();

      if (!date) { showToast('Please enter a date', 'error'); return; }
      if (!text) { showToast('Please enter the transcript text', 'error'); return; }

      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';

      try {
        if (isEdit) {
          const values = [
            existingTranscript.transcript_id,
            partner.partner_id,
            partner.display_name,
            date,
            text,
            existingTranscript.created_at,
          ];
          if (isConfigured()) {
            await updateRow(CONFIG.SHEET_TRANSCRIPTS, existingTranscript._rowIndex, values);
          } else {
            updateDemoRow(CONFIG.SHEET_TRANSCRIPTS, existingTranscript._rowIndex, values);
          }
          showToast('Transcript updated', 'success');
        } else {
          const values = [
            uuid('trn'),
            partner.partner_id,
            partner.display_name,
            date,
            text,
            nowISO(),
          ];
          if (isConfigured()) {
            await appendRow(CONFIG.SHEET_TRANSCRIPTS, values);
          } else {
            addDemoRow(CONFIG.SHEET_TRANSCRIPTS, values);
          }
          showToast('Transcript saved', 'success');
        }
        closeModal();
        if (onSaved) onSaved();
      } catch (err) {
        showToast(err.message || 'Failed to save transcript', 'error');
        saveBtn.disabled = false;
        saveBtn.textContent = isEdit ? 'Save Changes' : 'Save Transcript';
      }
    },
  }, isEdit ? 'Save Changes' : 'Save Transcript');

  openModal({
    title: isEdit ? 'Edit Transcript' : 'Add Call Transcript',
    content: formContent,
    className: 'modal--wide',
    footer: [
      el('button', { class: 'btn btn--secondary', onClick: closeModal }, 'Cancel'),
      saveBtn,
    ],
  });
}

async function handleDeleteTranscript(transcript, partner) {
  const confirmed = await confirmDialog(
    'Delete Transcript',
    `Are you sure you want to delete this transcript from ${formatDate(transcript.conversation_date)}? This cannot be undone.`
  );
  if (!confirmed) return;

  try {
    if (isConfigured()) {
      await deleteRow(CONFIG.SHEET_TRANSCRIPTS, transcript._rowIndex);
    } else {
      deleteDemoRow(CONFIG.SHEET_TRANSCRIPTS, transcript._rowIndex);
    }
    showToast('Transcript deleted', 'success');
    reRender(partner.partner_id);
  } catch (err) {
    showToast(err.message || 'Failed to delete', 'error');
  }
}

// ============================================
// Copy & PDF Export
// ============================================

function copyTranscriptText(transcript) {
  const text = `Partner: ${transcript.partner_name}\nDate: ${transcript.conversation_date}\n\n${transcript.transcript_text}`;
  navigator.clipboard.writeText(text).then(
    () => showToast('Transcript copied to clipboard', 'success'),
    () => showToast('Failed to copy', 'error')
  );
}

function downloadTranscriptPDF(transcript) {
  if (!window.jspdf) {
    showToast('PDF library loading, try again in a moment', 'error');
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  doc.setFontSize(18);
  doc.text(transcript.partner_name || 'Partner', 20, 20);

  doc.setFontSize(11);
  doc.setTextColor(100);
  doc.text(`Date: ${formatDate(transcript.conversation_date)}`, 20, 30);

  doc.setDrawColor(200);
  doc.line(20, 34, 190, 34);

  doc.setFontSize(10);
  doc.setTextColor(40);
  const lines = doc.splitTextToSize(transcript.transcript_text || '', 170);
  doc.text(lines, 20, 42);

  const fileName = `${(transcript.partner_name || 'transcript').replace(/\s+/g, '_')}_${transcript.conversation_date || 'undated'}.pdf`;
  doc.save(fileName);
  showToast('PDF downloaded', 'success');
}

function downloadAllTranscriptsPDF(partner, transcripts) {
  if (!window.jspdf) {
    showToast('PDF library loading, try again in a moment', 'error');
    return;
  }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  // Title page
  doc.setFontSize(22);
  doc.text(partner.display_name, 20, 30);
  doc.setFontSize(12);
  doc.setTextColor(100);
  doc.text('Call Transcripts', 20, 40);
  doc.text(`${transcripts.length} transcript(s)`, 20, 48);
  doc.setDrawColor(200);
  doc.line(20, 54, 190, 54);

  let y = 64;

  transcripts.forEach((t, i) => {
    if (y > 250 || i > 0) {
      doc.addPage();
      y = 20;
    }

    doc.setFontSize(13);
    doc.setTextColor(0);
    doc.text(`${formatDate(t.conversation_date)}`, 20, y);
    y += 8;

    doc.setDrawColor(220);
    doc.line(20, y, 190, y);
    y += 6;

    doc.setFontSize(10);
    doc.setTextColor(40);
    const lines = doc.splitTextToSize(t.transcript_text || '', 170);
    lines.forEach(line => {
      if (y > 280) { doc.addPage(); y = 20; }
      doc.text(line, 20, y);
      y += 5;
    });

    y += 10;
  });

  const fileName = `${partner.display_name.replace(/\s+/g, '_')}_All_Transcripts.pdf`;
  doc.save(fileName);
  showToast('All transcripts exported as PDF', 'success');
}

// ============================================
// Upcoming Events — Compact Consolidated View
// ============================================

const EVENT_TYPE_COLORS = {
  'Webinar': '#0000CC', 'Workshop': '#00BFFF',
  'Conference': '#1A1A2E', 'Campaign': '#CC8800', 'Other': '#4A4A5A',
};

// ============================================
// Revenue by Event Chart (Partner-scoped)
// ============================================

function buildPartnerRevenueByEvent(partnerEvents, opportunities) {
  const eventRevenue = {};
  for (const opp of opportunities) {
    const src = opp.lead_source;
    if (!src || src === 'salesperson') continue;
    const val = parseFloat(opp.deal_value) || 0;
    if (!eventRevenue[src]) eventRevenue[src] = { total: 0 };
    eventRevenue[src].total += val;
  }

  const data = [];
  for (const [eventId, rev] of Object.entries(eventRevenue)) {
    const evt = partnerEvents.find(e => e.event_id === eventId);
    const title = evt ? evt.title : eventId;
    const type = evt ? evt.event_type : 'Other';
    data.push({ title, type, total: rev.total });
  }
  data.sort((a, b) => b.total - a.total);

  if (data.length === 0) {
    return el('div', { class: 'demandgen-chart' },
      el('div', { class: 'demandgen-chart__title' }, 'Revenue by Event'),
      el('div', { class: 'demandgen-chart__subtitle', style: { color: 'var(--color-text-muted)' } }, 'No event-sourced revenue yet')
    );
  }

  const maxVal = Math.max(...data.map(d => d.total));

  const rows = data.map(d => {
    const pct = maxVal > 0 ? (d.total / maxVal) * 100 : 0;
    const color = EVENT_TYPE_COLORS[d.type] || EVENT_TYPE_COLORS['Other'];

    return el('div', { class: 'demandgen-bar-row' },
      el('div', { class: 'demandgen-bar-row__label', title: d.title }, d.title),
      el('div', { class: 'demandgen-bar-row__bar' },
        el('div', {
          class: 'demandgen-bar-row__segment',
          style: { width: pct + '%', background: color, borderRadius: 'var(--radius-sm)' },
        })
      ),
      el('div', { class: 'demandgen-bar-row__value' }, formatCurrency(d.total)),
    );
  });

  const usedTypes = [...new Set(data.map(d => d.type))];
  const legend = el('div', { class: 'demandgen-legend', style: { marginTop: 'var(--space-3)' } },
    ...usedTypes.map(type =>
      el('div', { class: 'demandgen-legend__item' },
        el('span', { class: 'demandgen-legend__dot', style: { background: EVENT_TYPE_COLORS[type] || EVENT_TYPE_COLORS['Other'] } }),
        type
      )
    )
  );

  return el('div', { class: 'demandgen-chart' },
    el('div', { class: 'demandgen-chart__title' }, 'Revenue by Event'),
    el('div', { class: 'demandgen-chart__subtitle' }, 'Pipeline from demand gen events'),
    el('div', { class: 'demandgen-bar-list' }, ...rows),
    legend,
  );
}

function buildUpcomingEventsSection(allEvents, partner, container) {
  const upcomingEvents = allEvents
    .filter(e => e.status === 'Upcoming' || e.status === 'In Progress')
    .sort((a, b) => new Date(a.event_date) - new Date(b.event_date));

  const completedCount = allEvents.filter(e => e.status === 'Completed').length;

  return el('div', { class: 'detail-section' },
    el('div', { class: 'detail-section__header' },
      el('div', {},
        el('h3', { class: 'detail-section__title' }, 'Upcoming Joint Events'),
        el('p', { style: { fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', margin: '0' } },
          `${upcomingEvents.length} upcoming \u00B7 ${completedCount} completed \u00B7 ${allEvents.length} total`
        )
      ),
      el('div', { style: { display: 'flex', gap: 'var(--space-2)' } },
        el('button', {
          class: 'btn btn--secondary btn--sm',
          onClick: () => navigate('/admin/events'),
        }, 'View All Events'),
        el('button', {
          class: 'btn btn--primary btn--sm',
          onClick: () => {
            openEventModal(null, container, () => reRender(partner.partner_id));
            setTimeout(() => {
              const sel = document.querySelector('#field-partner_id');
              if (sel) sel.value = partner.partner_id;
            }, 50);
          },
        },
          el('span', { html: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2v10M2 7h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' }),
          'New Event'
        ),
      )
    ),
    upcomingEvents.length > 0
      ? el('div', { class: 'upcoming-events-list' },
          ...upcomingEvents.map(evt => upcomingEventRow(evt, container))
        )
      : el('div', { class: 'empty-state', style: { padding: 'var(--space-6) var(--space-4)' } },
          el('div', { class: 'empty-state__title' }, 'No upcoming events'),
          el('div', { class: 'empty-state__description' }, 'All clear! Create a new event or check the Events tab for past events.')
        )
  );
}

function upcomingEventRow(evt, container) {
  const typeColor = EVENT_TYPE_COLORS[evt.event_type] || '#9B9A9B';
  const startDate = new Date(evt.event_date);
  const month = startDate.toLocaleDateString('en-US', { month: 'short' });
  const day = startDate.getDate();

  const dateRange = formatDate(evt.event_date) +
    (evt.end_date && evt.end_date !== evt.event_date ? ` — ${formatDate(evt.end_date)}` : '');

  return el('div', {
    class: 'upcoming-event-row',
    onClick: () => openEventModal(evt, container),
  },
    // Date badge
    el('div', { class: 'upcoming-event-row__date' },
      el('div', { class: 'upcoming-event-row__month' }, month),
      el('div', { class: 'upcoming-event-row__day' }, String(day))
    ),
    // Type indicator
    el('div', { class: 'upcoming-event-row__type-bar', style: { background: typeColor } }),
    // Content
    el('div', { class: 'upcoming-event-row__content' },
      el('div', { class: 'upcoming-event-row__title' }, evt.title),
      el('div', { class: 'upcoming-event-row__meta' },
        el('span', {
          class: 'upcoming-event-row__type-badge',
          style: { color: typeColor },
        }, evt.event_type),
        el('span', { class: 'upcoming-event-row__date-text' }, dateRange),
        evt.location ? el('span', { class: 'upcoming-event-row__location' }, evt.location) : null,
      )
    ),
    // Status
    el('div', { class: 'upcoming-event-row__status' },
      el('span', {
        class: `badge badge--xs badge--${evt.status === 'In Progress' ? 'in-progress' : 'registered'}`,
      }, evt.status || 'Upcoming')
    )
  );
}

export function cleanup() {}
