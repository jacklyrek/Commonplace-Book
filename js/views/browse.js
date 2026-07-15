// Browse — §8.4: books and topics; tapping one shows its entries in the Library.
import { listTags, tagUsageCounts } from '../store.js';
import { h, icon, topbar } from '../ui.js';
import { libraryState } from './library.js';

export async function renderBrowse(container) {
  const [tags, counts] = await Promise.all([listTags(), tagUsageCounts()]);
  const books = tags.filter((t) => t.kind === 'book');
  const topics = tags.filter((t) => t.kind === 'topic');

  const open = (tag) => {
    libraryState.tagIds = new Set([tag.id]);
    libraryState.q = '';
    libraryState.star = false;
    location.hash = '#/';
  };

  container.append(
    topbar({ title: 'Browse' }),
    h(
      'section',
      { class: 'browse-section' },
      h('h2', {}, 'Books'),
      books.length
        ? h(
            'div',
            { class: 'booklist' },
            books.map((tag) =>
              h(
                'button',
                { class: 'bookrow', onclick: () => open(tag) },
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
          )
        : h('p', { class: 'hint' }, 'No books yet — tag an entry with a book to see it here.')
    ),
    h(
      'section',
      { class: 'browse-section' },
      h('h2', {}, 'Topics'),
      topics.length
        ? h(
            'div',
            { class: 'topicgrid' },
            topics.map((tag) =>
              h(
                'button',
                { class: 'chip', onclick: () => open(tag) },
                tag.name,
                h('span', { class: 'count' }, String(counts.get(tag.id) || 0))
              )
            )
          )
        : h('p', { class: 'hint' }, 'No topics yet — add topic tags when saving an entry.')
    )
  );
}
