// App bootstrap: hash router, tab bar, service-worker registration.
import { renderLibrary } from './views/library.js';
import { renderEntryForm } from './views/entryForm.js';
import { renderEntryDetail } from './views/entryDetail.js';
import { renderBrowse } from './views/browse.js';
import { renderSettings } from './views/settings.js';
import { icon, toast } from './ui.js';
import { initAutoSync } from './sync.js';

const ROUTES = [
  { pattern: /^$/, view: renderLibrary, tab: 'library' },
  { pattern: /^add$/, view: renderEntryForm, tab: null },
  { pattern: /^edit\/(.+)$/, view: renderEntryForm, tab: null },
  { pattern: /^entry\/(.+)$/, view: renderEntryDetail, tab: null },
  { pattern: /^browse$/, view: renderBrowse, tab: 'browse' },
  { pattern: /^settings$/, view: renderSettings, tab: 'settings' },
];

let renderToken = 0;
let lastRouteKey = null;
const savedScrollPositions = new Map();

async function render() {
  const path = location.hash.replace(/^#\/?/, '');
  const route = ROUTES.find((r) => r.pattern.test(path)) || ROUTES[0];
  const param = path.match(route.pattern)?.[1];
  const routeKey = route.tab || path || 'default';

  // Tab bar only on top-level screens.
  const tabbar = document.getElementById('tabbar');
  tabbar.classList.toggle('hidden', !route.tab);
  for (const link of tabbar.querySelectorAll('a')) {
    link.classList.toggle('active', link.dataset.route === route.tab);
  }

  if (lastRouteKey && lastRouteKey !== routeKey) {
    const scrollEl = document.scrollingElement || document.documentElement;
    savedScrollPositions.set(lastRouteKey, scrollEl.scrollTop);
  }

  const app = document.getElementById('app');
  const token = ++renderToken;
  const stage = document.createElement('div');
  await route.view(stage, param ? decodeURIComponent(param) : undefined);
  if (token !== renderToken) return; // a newer navigation superseded this one
  app.replaceChildren(...stage.childNodes);

  if (!lastRouteKey) {
    window.scrollTo(0, 0);
  } else if (lastRouteKey !== routeKey) {
    const savedTop = savedScrollPositions.get(routeKey);
    window.scrollTo(0, typeof savedTop === 'number' ? savedTop : 0);
  }

  lastRouteKey = routeKey;
}

function initTabIcons() {
  for (const span of document.querySelectorAll('#tabbar .tab-icon')) {
    span.replaceWith(icon(span.dataset.icon));
  }
}

window.addEventListener('hashchange', render);
initTabIcons();
render();
initAutoSync();

// A background pull brought remote changes — refresh list views so they show up.
window.addEventListener('cb-sync', () => {
  const path = location.hash.replace(/^#\/?/, '');
  const route = ROUTES.find((r) => r.pattern.test(path)) || ROUTES[0];
  if (route.tab === 'library' || route.tab === 'browse') render();
});

if ('serviceWorker' in navigator) {
  // A new service worker taking over means a new app version just activated —
  // tell the user so deploys are visible (skip the very first install).
  let hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) toast('App updated — reload to use the newest version.', 3500);
    hadController = true;
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  });
}
