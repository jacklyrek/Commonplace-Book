// Browse — §8.4: books and topics; tap to select one or more, then jump to
// the Library filtered on all of them at once.
import { listTags, listEntriesFull, tagCounts } from '../store.js';
import { h, icon, topbar } from '../ui.js';
import { libraryState } from './library.js';

export async function renderBrowse(container) {
  const [tags, entries] = await Promise.all([listTags(), listEntriesFull()]);
  const books = tags.filter((t) => t.kind === 'book');
  const topics = tags.filter((t) => t.kind === 'topic');

  // Seed from whatever's already applied in the Library so hopping between
  // tabs doesn't lose a selection in progress.
  const selected = new Set([...libraryState.tagIds].filter((id) => tags.some((t) => t.id === id)));

  const bookList = h('div', { class: 'booklist' });
  const topicGrid = h('div', { class: 'topicgrid' });
  const bookOverlapMsg = h('p', { class: 'hint', hidden: true }, 'No books overlap with your selection.');
  const topicOverlapMsg = h('p', { class: 'hint', hidden: true }, 'No topics overlap with your selection.');
  const bar = h('div', { class: 'selectbar' });

  const renderBar = () => {
    bar.hidden = selected.size === 0;
    bar.replaceChildren(
      h(
        'span',
        { class: 'selectbar-count' },
        `${selected.size} tag${selected.size === 1 ? '' : 's'} selected`
      ),
      h(
        'button',
        {
          class: 'btn',
          onclick: () => {
            selected.clear();
            renderRows();
            renderBar();
          },
        },
        'Clear'
      ),
      h(
        'button',
        {
          class: 'btn primary',
          onclick: () => {
            libraryState.tagIds = new Set(selected);
            libraryState.q = '';
            libraryState.star = false;
            location.hash = '#/';
          },
        },
        'Show entries'
      )
    );
  };

  const toggle = (tag) => {
    selected.has(tag.id) ? selected.delete(tag.id) : selected.add(tag.id);
    renderRows();
    renderBar();
  };

  // Counts reflect entries matching what's already selected *plus* that tag
  // — how many you'd get by adding it — so they narrow as you pick more. A
  // tag with zero overlap can't narrow the result further, so it drops out
  // of the list entirely (unless it's already selected, so it stays
  // reachable to deselect even once the combination has emptied out).
  const renderRows = () => {
    const counts = tagCounts(entries, selected);
    const visible = (t) => selected.has(t.id) || (counts.get(t.id) || 0) > 0;
    const visibleBooks = books.filter(visible);
    const visibleTopics = topics.filter(visible);

    bookList.replaceChildren(
      ...visibleBooks.map((tag) =>
        h(
          'button',
          {
            class: `bookrow ${selected.has(tag.id) ? 'active' : ''}`,
            onclick: () => toggle(tag),
          },
          icon('book'),
          h(
            'span',
            { class: 'bookmain' },
            h('strong', {}, tag.name),
            tag.author ? h('span', {}, tag.author) : null
          ),
          h('span', { class: 'count' }, String(counts.get(tag.id) || 0))
        )
      )
    );
    topicGrid.replaceChildren(
      ...visibleTopics.map((tag) =>
        h(
          'button',
          { class: `chip ${selected.has(tag.id) ? 'active' : ''}`, onclick: () => toggle(tag) },
          tag.name,
          h('span', { class: 'count' }, String(counts.get(tag.id) || 0))
        )
      )
    );
    bookOverlapMsg.hidden = !(books.length && visibleBooks.length === 0);
    topicOverlapMsg.hidden = !(topics.length && visibleTopics.length === 0);
  };

  container.append(
    topbar({ title: 'Browse' }),
    h('p', { class: 'hint' }, 'Tap to select one or more tags, then view their entries together.'),
    h(
      'section',
      { class: 'browse-section' },
      h('h2', {}, 'Books'),
      books.length
        ? [bookList, bookOverlapMsg]
        : h('p', { class: 'hint' }, 'No books yet — tag an entry with a book to see it here.')
    ),
    h(
      'section',
      { class: 'browse-section' },
      h('h2', {}, 'Topics'),
      topics.length
        ? [topicGrid, topicOverlapMsg]
        : h('p', { class: 'hint' }, 'No topics yet — add topic tags when saving an entry.')
    ),
    h('div', { style: 'height:70px' }),
    bar
  );

  renderRows();
  renderBar();
}
