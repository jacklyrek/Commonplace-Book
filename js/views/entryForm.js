// Add / Edit entry — §8.2, including the photo → crop → OCR → edit flow (§6).
import {
  getEntryFull,
  saveEntry,
  setEntryTags,
  ensureTag,
  listTags,
  putImage,
  getImage,
  deleteImage,
} from '../store.js';
import { h, icon, toast, topbar, showProgress } from '../ui.js';
import { downscaleImage } from '../images.js';
import { openCropper } from '../crop.js';
import { recognize, cancelOcr } from '../ocr.js';

export async function renderEntryForm(container, entryId = null) {
  const existing = entryId ? await getEntryFull(entryId) : null;
  if (entryId && !existing) {
    toast('Entry not found.');
    location.hash = '#/';
    return;
  }

  const bookTags = await listTags('book');
  const topicTags = await listTags('topic');

  const state = {
    quote: existing?.quote || '',
    reflection: existing?.reflection || '',
    page: existing?.page || '',
    starred: existing?.starred || false,
    bookName: existing?.book?.name || '',
    bookAuthor: existing?.book?.author || '',
    topics: existing ? existing.topics.map((t) => t.name) : [],
    imageBlob: null, // set when a new photo is captured this session
    removeImage: false, // user removed the existing photo
  };

  /* ---------- quote ---------- */

  const quoteBox = h('textarea', {
    class: 'input quotebox',
    placeholder: 'Type or paste the passage — or use “From photo”.',
    oninput: (e) => {
      state.quote = e.target.value;
      autogrow(e.target);
    },
  });
  quoteBox.value = state.quote;

  function autogrow(el) {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + 2, 420)}px`;
  }

  /* ---------- photo + OCR ---------- */

  const photoArea = h('div', { class: 'photorow' });

  async function currentPhotoBlob() {
    if (state.imageBlob) return state.imageBlob;
    if (existing?.image_ref && !state.removeImage) {
      return (await getImage(existing.image_ref))?.blob || null;
    }
    return null;
  }

  async function renderPhoto() {
    const blob = await currentPhotoBlob();
    photoArea.replaceChildren();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const img = h('img', { src: url, alt: 'Attached photo' });
    img.addEventListener('load', () => URL.revokeObjectURL(url));
    photoArea.append(
      h(
        'div',
        { class: 'photothumb' },
        img,
        h(
          'button',
          {
            class: 'removephoto',
            'aria-label': 'Remove photo',
            onclick: () => {
              state.imageBlob = null;
              state.removeImage = true;
              renderPhoto();
            },
          },
          icon('x')
        )
      )
    );
  }

  async function handlePhoto(file) {
    if (!file) return;
    let photo;
    try {
      photo = await downscaleImage(file, 2000, 0.87);
    } catch {
      toast('Could not read that image.');
      return;
    }

    const cropped = await openCropper(photo);
    if (!cropped) return; // cancelled

    let cancelled = false;
    const progress = showProgress('Loading OCR engine…', {
      onCancel: () => {
        cancelled = true;
        cancelOcr();
      },
    });
    let text = '';
    try {
      text = await recognize(cropped, (pct, label) => progress.update(pct, label));
    } catch (err) {
      if (!cancelled) {
        progress.close();
        console.error(err);
        toast('Text recognition failed — you can still type the passage.');
      }
    }
    if (cancelled) return;
    progress.close();

    // Attach the (downscaled) original so it can be re-read later (§6 step 5).
    state.imageBlob = photo;
    state.removeImage = false;
    renderPhoto();

    if (text) {
      state.quote = state.quote.trim() ? `${state.quote.trim()}\n\n${text}` : text;
      quoteBox.value = state.quote;
      autogrow(quoteBox);
      toast('Text recognized — review and fix any slips.');
    } else {
      toast('No text found in that photo — it’s attached anyway.');
    }
  }

  const cameraInput = h('input', {
    type: 'file',
    accept: 'image/*',
    capture: 'environment',
    hidden: true,
    onchange: (e) => {
      handlePhoto(e.target.files[0]);
      e.target.value = '';
    },
  });
  const libraryInput = h('input', {
    type: 'file',
    accept: 'image/*',
    hidden: true,
    onchange: (e) => {
      handlePhoto(e.target.files[0]);
      e.target.value = '';
    },
  });

  /* ---------- book picker: tap one existing book, or create a new one ---------- */

  const bookChipWrap = h('div', { class: 'chipwrap' });
  const authorHint = h('div', { class: 'hint' });

  const newBookName = h('input', {
    class: 'input',
    type: 'text',
    placeholder: 'New book title',
    autocomplete: 'off',
    oninput: (e) => {
      state.bookName = e.target.value;
      state.bookAuthor = newBookAuthor.value;
      renderBookChips();
    },
  });
  const newBookAuthor = h('input', {
    class: 'input',
    type: 'text',
    placeholder: 'Author (optional)',
    autocomplete: 'off',
    oninput: (e) => {
      state.bookAuthor = e.target.value;
    },
  });
  // Open by default when there are no books to pick from yet.
  const newBookPanel = h(
    'div',
    { class: 'newbook', hidden: bookTags.length > 0 },
    newBookName,
    newBookAuthor
  );

  function selectedBook() {
    return bookTags.find((t) => t.name.toLowerCase() === state.bookName.trim().toLowerCase());
  }

  function openNewBook(open) {
    newBookPanel.hidden = !open;
    if (open) {
      // Whatever is typed in the panel becomes the (new) book.
      state.bookName = newBookName.value;
      state.bookAuthor = newBookAuthor.value;
      newBookName.focus();
    } else {
      newBookName.value = '';
      newBookAuthor.value = '';
    }
  }

  function renderBookChips() {
    const selected = selectedBook();
    bookChipWrap.replaceChildren(
      ...bookTags.map((t) =>
        h(
          'button',
          {
            type: 'button',
            class: `chip ${selected?.id === t.id ? 'active' : ''}`,
            onclick: () => {
              if (selected?.id === t.id) {
                // Tap again to deselect.
                state.bookName = '';
                state.bookAuthor = '';
              } else {
                state.bookName = t.name;
                state.bookAuthor = t.author || '';
                openNewBook(false);
              }
              renderBookChips();
            },
          },
          icon('book'),
          t.name
        )
      ),
      h(
        'button',
        {
          type: 'button',
          class: `chip ${!newBookPanel.hidden ? 'active' : ''}`,
          onclick: () => {
            openNewBook(newBookPanel.hidden);
            renderBookChips();
          },
        },
        icon('plus'),
        'New book'
      )
    );
    authorHint.textContent = selectedBook()?.author ? `by ${selectedBook().author}` : '';
  }

  /* ---------- topic tags: tap to toggle existing, add new below ---------- */

  const topicChipWrap = h('div', { class: 'chipwrap' });

  const hasTopic = (name) => state.topics.some((t) => t.toLowerCase() === name.toLowerCase());

  function toggleTopic(name) {
    if (hasTopic(name)) {
      state.topics = state.topics.filter((t) => t.toLowerCase() !== name.toLowerCase());
    } else {
      state.topics.push(name);
    }
    renderTopicChips();
  }

  function renderTopicChips() {
    // Existing topics first (alphabetical), then any new ones added this session.
    const extras = state.topics.filter(
      (name) => !topicTags.some((t) => t.name.toLowerCase() === name.toLowerCase())
    );
    const chip = (name, active) =>
      h(
        'button',
        { type: 'button', class: `chip ${active ? 'active' : ''}`, onclick: () => toggleTopic(name) },
        name
      );
    topicChipWrap.replaceChildren(
      ...topicTags.map((t) => chip(t.name, hasTopic(t.name))),
      ...extras.map((name) => chip(name, true))
    );
  }

  const topicInput = h('input', {
    class: 'input',
    type: 'text',
    placeholder: 'New topic',
    autocomplete: 'off',
    autocapitalize: 'none',
    onkeydown: (e) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        addTopic();
      }
    },
  });

  function addTopic() {
    const name = topicInput.value.replace(/,/g, '').trim();
    if (name && !hasTopic(name)) state.topics.push(name);
    topicInput.value = '';
    renderTopicChips();
  }

  /* ---------- page + reflection ---------- */

  const pageInput = h('input', {
    class: 'input',
    type: 'text',
    inputmode: 'numeric',
    placeholder: 'e.g. 142',
    oninput: (e) => {
      state.page = e.target.value;
    },
  });
  pageInput.value = state.page;

  const reflectionBox = h('textarea', {
    class: 'input',
    placeholder: 'Your own thoughts on this passage…',
    oninput: (e) => {
      state.reflection = e.target.value;
    },
  });
  reflectionBox.value = state.reflection;

  /* ---------- save ---------- */

  let saving = false;
  async function save() {
    if (saving) return;
    if (!state.quote.trim()) {
      toast('The quote is empty — add the passage first.');
      quoteBox.focus();
      return;
    }
    saving = true;
    try {
      // Photo bookkeeping: replace/remove the stored image as needed.
      let imageRef = existing?.image_ref ?? null;
      if (state.imageBlob) {
        if (imageRef) await deleteImage(imageRef);
        imageRef = await putImage(state.imageBlob);
      } else if (state.removeImage && imageRef) {
        await deleteImage(imageRef);
        imageRef = null;
      }

      const entry = await saveEntry({
        ...(existing || {}),
        quote: state.quote.trim(),
        reflection: state.reflection.trim() || null,
        page: state.page.trim() || null,
        image_ref: imageRef,
        starred: state.starred,
      });

      const tagIds = [];
      if (state.bookName.trim()) {
        const book = await ensureTag(state.bookName, 'book', state.bookAuthor);
        tagIds.push(book.id);
      }
      for (const name of state.topics) {
        const topic = await ensureTag(name, 'topic');
        tagIds.push(topic.id);
      }
      await setEntryTags(entry.id, tagIds);

      toast(existing ? 'Entry updated.' : 'Entry saved.');
      location.replace(`#/entry/${entry.id}`);
    } catch (err) {
      console.error(err);
      toast('Saving failed — please try again.');
      saving = false;
    }
  }

  /* ---------- layout ---------- */

  const reflectionDetails = h(
    'details',
    { class: 'reflection', open: !!state.reflection },
    h('summary', {}, state.reflection ? 'Reflection' : 'Add a reflection (optional)'),
    reflectionBox
  );

  container.append(
    topbar({ title: existing ? 'Edit entry' : 'New entry', back: true }),
    h(
      'div',
      { class: 'field' },
      h('label', {}, 'Quote'),
      quoteBox,
      h(
        'div',
        { style: 'display:flex;gap:10px;margin-top:10px' },
        h('button', { class: 'btn', onclick: () => cameraInput.click() }, icon('camera'), 'From photo'),
        h('button', { class: 'btn', onclick: () => libraryInput.click() }, icon('image'), 'Choose photo')
      ),
      cameraInput,
      libraryInput
    ),
    h('div', { class: 'field' }, photoArea),
    h(
      'div',
      { class: 'field' },
      h('label', {}, 'Book'),
      bookChipWrap,
      authorHint,
      newBookPanel
    ),
    h(
      'div',
      { class: 'field' },
      h('label', {}, 'Topics'),
      topicChipWrap,
      h(
        'div',
        { class: 'addrow' },
        topicInput,
        h('button', { class: 'btn', onclick: addTopic }, 'Add')
      )
    ),
    h('div', { class: 'field' }, h('label', {}, 'Page'), pageInput),
    h('div', { class: 'field' }, reflectionDetails),
    h('div', { style: 'height:64px' }),
    h(
      'div',
      { class: 'savebar' },
      h('button', { class: 'btn primary block', onclick: save }, existing ? 'Save changes' : 'Save entry')
    )
  );

  autogrow(quoteBox);
  renderPhoto();
  renderBookChips();
  renderTopicChips();
}
