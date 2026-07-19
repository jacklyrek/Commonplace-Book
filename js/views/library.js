// Library (home) — §8.1: reverse-chron list, search, filter chips, sort, star
// filter, resurface-random, floating "+".
import { listEntriesFull, randomEntry, toggleStar, tagUsageCounts, listTags } from '../store.js';
import { h, icon, fmtDate, debounce, toast, topbar } from '../ui.js';

// Kept across navigations so Browse can hand off a tag filter and back-nav
// returns to the same filtered view.
export const libraryState = {
  q: '',
  tagIds: new Set(),
  star: false,
  sort: 'date', // 'date' | 'book' | 'author'
};

function matches(entry, q) {
  if (!q) return true;
  const hay = [
    entry.quote,
    entry.reflection,
    entry.page,
    entry.book?.name,
    entry.book?.author,
    ...entry.topics.map((t) => t.name),
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .every((word) => hay.includes(word));
}

function sortEntries(entries, sort) {
  const byDateDesc = (a, b) => b.created_at.localeCompare(a.created_at);
  if (sort === 'book' || sort === 'author') {
    const key = (e) => (sort === 'book' ? e.book?.name : e.book?.author) || null;
    return entries.sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      if (ka && kb) {
        const cmp = ka.localeCompare(kb, undefined, { sensitivity: 'base' });
        if (cmp) return cmp;
        return byDateDesc(a, b);
      }
      if (ka) return -1; // entries without a book/author sort last
      if (kb) return 1;
      return byDateDesc(a, b);
    });
  }
  return entries.sort(byDateDesc);
}

function applyFilters(entries) {
  let out = entries;
  if (libraryState.star) out = out.filter((e) => e.starred);
  if (libraryState.tagIds.size) {
    out = out.filter((e) => {
      const ids = new Set(e.tags.map((t) => t.id));
      return [...libraryState.tagIds].every((id) => ids.has(id));
    });
  }
  out = out.filter((e) => matches(e, libraryState.q));
  return sortEntries(out, libraryState.sort);
}

function entryCard(entry, onStarChange) {
  const starBtn = h(
    'button',
    {
      class: `iconbtn ${entry.starred ? 'starred' : ''}`,
      'aria-label': entry.starred ? 'Unstar' : 'Star',
      onclick: async (e) => {
        e.stopPropagation();
        const updated = await toggleStar(entry.id);
        entry.starred = updated.starred;
        starBtn.classList.toggle('starred', entry.starred);
        onStarChange();
      },
    },
    icon('star')
  );

  const sourceBits = [];
  if (entry.book) {
    sourceBits.push(h('span', { class: 'bookname' }, entry.book.name));
    if (entry.book.author) sourceBits.push(h('span', {}, `— ${entry.book.author}`));
  }
  if (entry.page) sourceBits.push(h('span', {}, `· p. ${entry.page}`));

  return h(
    'article',
    { class: 'card', onclick: () => (location.hash = `#/entry/${entry.id}`) },
    h('div', { class: 'quote' }, entry.quote),
    sourceBits.length ? h('div', { class: 'meta' }, ...sourceBits) : null,
    entry.topics.length
      ? h(
          'div',
          { class: 'topics' },
          entry.topics.map((t) => h('span', { class: 'chip small' }, t.name))
        )
      : null,
    h(
      'div',
      { class: 'cardfoot' },
      h('span', {}, fmtDate(entry.created_at)),
      starBtn
    )
  );
}

export async function renderLibrary(container) {
  const [entries, allTags, counts] = await Promise.all([
    listEntriesFull(),
    listTags(),
    tagUsageCounts(),
  ]);

  // Drop stale tag filters (tag may have been orphaned by deletions).
  for (const id of [...libraryState.tagIds]) {
    if (!allTags.some((t) => t.id === id)) libraryState.tagIds.delete(id);
  }

  const list = h('div', { class: 'cards' });
  const chiprow = h('div', { class: 'chiprow' });

  const renderList = () => {
    const filtered = applyFilters([...entries]);
    list.replaceChildren(
      ...(filtered.length
        ? filtered.map((e) => entryCard(e, renderList))
        : [emptyState(entries.length)])
    );
  };

  const renderChips = () => {
    const hasFilters = libraryState.star || libraryState.tagIds.size || libraryState.q;
    const sortSel = h(
      'select',
      {
        class: 'sortsel',
        'aria-label': 'Sort entries',
        onchange: (e) => {
          libraryState.sort = e.target.value;
          renderList();
        },
      },
      h('option', { value: 'date' }, 'Newest'),
      h('option', { value: 'book' }, 'By book'),
      h('option', { value: 'author' }, 'By author')
    );
    sortSel.value = libraryState.sort;

    const tagChip = (tag) =>
      h(
        'button',
        {
          class: `chip ${libraryState.tagIds.has(tag.id) ? 'active' : ''}`,
          onclick: () => {
            libraryState.tagIds.has(tag.id)
              ? libraryState.tagIds.delete(tag.id)
              : libraryState.tagIds.add(tag.id);
            renderChips();
            renderList();
          },
        },
        tag.kind === 'book' ? icon('book') : null,
        tag.name,
        h('span', { class: 'count' }, String(counts.get(tag.id) || 0))
      );

    const usedTags = allTags.filter((t) => counts.get(t.id) || libraryState.tagIds.has(t.id));
    const books = usedTags.filter((t) => t.kind === 'book');
    const topics = usedTags.filter((t) => t.kind === 'topic');

    chiprow.replaceChildren(
      ...[
        sortSel,
        h(
          'button',
          {
            class: `chip ${libraryState.star ? 'active' : ''}`,
            onclick: () => {
              libraryState.star = !libraryState.star;
              renderChips();
              renderList();
            },
          },
          icon('star'),
          'Starred'
        ),
        ...books.map(tagChip),
        ...topics.map(tagChip),
        hasFilters
          ? h(
              'button',
              {
                class: 'chip',
                onclick: () => {
                  libraryState.q = '';
                  libraryState.star = false;
                  libraryState.tagIds.clear();
                  searchInput.value = '';
                  renderChips();
                  renderList();
                },
              },
              icon('x'),
              'Clear'
            )
          : null,
      ].filter(Boolean)
    );
  };

  const searchInput = h('input', {
    class: 'search',
    type: 'search',
    placeholder: 'Search quotes, books, tags…',
    value: libraryState.q,
    oninput: debounce((e) => {
      libraryState.q = e.target.value.trim();
      renderList();
      renderChips();
    }, 120),
  });

  const resurface = async () => {
    const entry = await randomEntry();
    if (!entry) return toast('Nothing to resurface yet — add an entry first.');
    location.hash = `#/entry/${entry.id}`;
  };

  container.append(
    topbar({
      title: 'Commonplace Book',
      actions: [
        h(
          'button',
          { class: 'iconbtn', 'aria-label': 'Resurface a random entry', onclick: resurface },
          icon('shuffle')
        ),
      ],
    }),
    h('div', { class: 'searchwrap' }, icon('search'), searchInput),
    chiprow,
    list,
    h(
      'button',
      { class: 'fab', 'aria-label': 'Add entry', onclick: () => (location.hash = '#/add') },
      icon('plus')
    )
  );

  renderChips();
  renderList();
}

function emptyState(totalCount) {
  if (totalCount === 0) {
    return h(
      'div',
      { class: 'empty' },
      h('div', { class: 'bigicon' }, icon('book')),
      h('h2', {}, 'Your commonplace book is empty'),
      h('p', {}, 'Capture a passage from a book — by photo or by hand.'),
      h(
        'button',
        { class: 'btn primary', onclick: () => (location.hash = '#/add') },
        icon('plus'),
        'Add your first entry'
      )
    );
  }
  return h(
    'div',
    { class: 'empty' },
    h('h2', {}, 'No matches'),
    h('p', {}, 'Try a different search or clear the filters.')
  );
}
