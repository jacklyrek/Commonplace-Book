// Fullscreen crop step using self-hosted Cropper.js (§6 step 2).
// Resolves with a cropped JPEG blob, the original blob ("Use full photo"),
// or null if the user cancels.
import { h, loadScript } from './ui.js';

const CROPPER_SRC = new URL('../vendor/cropperjs/cropper.min.js', import.meta.url).href;

export async function openCropper(blob) {
  await loadScript(CROPPER_SRC);
  const url = URL.createObjectURL(blob);

  return new Promise((resolve) => {
    let cropper = null;

    const finish = (result) => {
      if (cropper) cropper.destroy();
      URL.revokeObjectURL(url);
      overlay.remove();
      resolve(result);
    };

    const done = () => {
      if (!cropper) return finish(blob);
      const canvas = cropper.getCroppedCanvas({ maxWidth: 2400, maxHeight: 2400 });
      canvas.toBlob((out) => finish(out || blob), 'image/jpeg', 0.92);
    };

    const img = h('img', { src: url, alt: 'Photo to crop' });
    const overlay = h(
      'div',
      { class: 'cropoverlay' },
      h('div', { class: 'crophint' }, 'Crop down to just the passage — tighter crops read better.'),
      h('div', { class: 'cropstage' }, img),
      h(
        'div',
        { class: 'cropbar' },
        h('button', { class: 'btn', onclick: () => finish(null) }, 'Cancel'),
        h('button', { class: 'btn', onclick: () => finish(blob) }, 'Full photo'),
        h('button', { class: 'btn primary', onclick: done }, 'Recognize')
      )
    );
    document.getElementById('overlays').append(overlay);

    img.addEventListener('load', () => {
      cropper = new globalThis.Cropper(img, {
        viewMode: 1,
        dragMode: 'move',
        autoCropArea: 0.9,
        background: false,
        movable: true,
        rotatable: false,
        scalable: false,
        zoomable: true,
        checkOrientation: false,
      });
    });
  });
}
