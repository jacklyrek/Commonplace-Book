// Entry detail — §8.3: full quote, source, topics, reflection, photo,
// star / edit / delete.
import { getEntryFull, getImage, toggleStar, deleteEntry } from '../store.js';
import { h, icon, fmtDate, toast, topbar, confirmDialog, openImageViewer } from '../ui.js';
import { libraryState } from './library.js';

export async function renderEntryDetail(container, entryId) {
  const entry = await getEntryFull(entryId);
  if (!entry) {
    toast('Entry not found.');
    location.hash = '#/';
    return;
  }

  const starBtn = h(
    'button',
    {
      class: `iconbtn ${entry.starred ? 'starred' : ''}`,
      'aria-label': entry.starred ? 'Unstar' : 'Star',
      onclick: async () => {
        const updated = await toggleStar(entry.id);
        entry.starred = updated.starred;
        starBtn.classList.toggle('starred', entry.starred);
      },
    },
    icon('star')
  );

  const remove = async () => {
    const ok = await confirmDialog('Delete this entry? This cannot be undone.', {
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    await deleteEntry(entry.id);
    toast('Entry deleted.');
    location.hash = '#/';
  };

  const goToTag = (tag) => {
    libraryState.tagIds = new Set([tag.id]);
    libraryState.q = '';
    libraryState.star = false;
    location.hash = '#/';
  };

  const sourceBits = [];
  if (entry.book) {
    sourceBits.push(h('span', { class: 'bookname' }, entry.book.name));
    if (entry.book.author) sourceBits.push(` — ${entry.book.author}`);
  }
  if (entry.page) sourceBits.push(`${sourceBits.length ? ' · ' : ''}p. ${entry.page}`);

  const photoSection = h('div', {});
  if (entry.image_ref) {
    getImage(entry.image_ref).then((record) => {
      if (!record) return;
      const url = URL.createObjectURL(record.blob);
      const img = h('img', { src: url, alt: 'Source photo — tap to enlarge' });
      img.addEventListener('load', () => URL.revokeObjectURL(url));
      photoSection.append(
        h(
          'div',
          { class: 'detail-section detail-photo' },
          h('h3', {}, 'Source photo'),
          h('div', { style: 'cursor:zoom-in', onclick: () => openImageViewer(record.blob) }, img)
        )
      );
    });
  }

  container.append(
    topbar({
      title: entry.book ? entry.book.name : 'Entry',
      back: true,
      actions: [
        starBtn,
        h(
          'button',
          {
            class: 'iconbtn',
            'aria-label': 'Edit',
            onclick: () => (location.hash = `#/edit/${entry.id}`),
          },
          icon('edit')
        ),
        h('button', { class: 'iconbtn danger', 'aria-label': 'Delete', onclick: remove }, icon('trash')),
      ],
    }),
    h('blockquote', { class: 'detail-quote' }, entry.quote),
    sourceBits.length ? h('div', { class: 'detail-source' }, ...sourceBits) : null,
    entry.topics.length
      ? h(
          'div',
          { class: 'detail-section' },
          h('h3', {}, 'Topics'),
          h(
            'div',
            { class: 'topicgrid' },
            entry.topics.map((t) =>
              h('button', { class: 'chip', onclick: () => goToTag(t) }, t.name)
            )
          )
        )
      : null,
    entry.reflection
      ? h(
          'div',
          { class: 'detail-section' },
          h('h3', {}, 'Reflection'),
          h('div', { class: 'reflectiontext' }, entry.reflection)
        )
      : null,
    photoSection,
    h(
      'div',
      { class: 'detail-dates' },
      `Added ${fmtDate(entry.created_at)}`,
      entry.updated_at !== entry.created_at ? ` · edited ${fmtDate(entry.updated_at)}` : ''
    )
  );
}
