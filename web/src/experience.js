// Full-screen control room: the same module as the homepage section, filling the window.
import './polyfills.js';
import { mountControlRoom } from './controlroom.js';
import { applyLang, currentLang } from './i18n.js';

let lang = currentLang();
applyLang(lang);
const control = mountControlRoom(document.querySelector('[data-control]'), lang);
const no3d = () => document.documentElement.classList.add('no-3d');
import('./scene/viewer.js')
  .then(({ createViewer }) => {
    try { control.attach(createViewer, () => control.stage.classList.add('is-lost')); } catch { no3d(); }
  })
  .catch(no3d);
document.querySelector('[data-lang-toggle]').addEventListener('click', () => {
  lang = lang === 'ar' ? 'en' : 'ar';
  applyLang(lang);
  control.setLang(lang);
});
