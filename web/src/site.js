// WAREVA company site: smooth scroll, the scroll-driven story of one liter, and the live control room.
import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import rules from '../../core/rules.json';
import { Plant } from '../../twin/plant.js';
import { mountControlRoom } from './controlroom.js';
import { STRINGS, applyLang, currentLang } from './i18n.js';
import { createViewer } from './scene/viewer.js';

gsap.registerPlugin(ScrollTrigger);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let lang = currentLang();
applyLang(lang);

// Smooth scrolling, kept in step with ScrollTrigger.
let lenis = null;
if (!reduceMotion) {
  lenis = new Lenis({ lerp: 0.085 });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add(time => lenis.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
}
for (const link of document.querySelectorAll('a[href^="#"]')) {
  link.addEventListener('click', e => {
    const target = document.querySelector(link.getAttribute('href'));
    if (!target) return;
    e.preventDefault();
    if (lenis) lenis.scrollTo(target, { offset: link.hasAttribute('data-scroll-to') ? 0 : -70, duration: 1.6 });
    else target.scrollIntoView();
  });
}
const nav = document.querySelector('[data-nav]');
const onScroll = () => nav.classList.toggle('is-scrolled', window.scrollY > 60);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

// The story ------------------------------------------------------------------
const CHAPTERS = ['overview', 'collect', 'treat', 'sense', 'gate', 'decide'];
const STOP = { overview: 'overview', collect: 'collect', treat: 'treat', sense: 'sense', gate: 'gate', decide: 'lawn' };
const FOCUS = { collect: 'collect', treat: 'treat', sense: 'sense', gate: 'cabinet', decide: 'gate' };
const LABELS = ['collect', 'treat', 'sense', 'gate', 'cabinet'];
const labelText = l => Object.fromEntries(LABELS.map(k => [k, STRINGS[l][`label.${k}`]]));

const storyEl = document.querySelector('[data-story]');
const story = createViewer(document.querySelector('[data-story-stage]'), { labels: labelText(lang), lang });
story.goTo('overview', 'overview', 0, false);
const frameStory = () => story.frame(lang === 'ar' ? 1 : -1);
frameStory();
const plant = new Plant(rules, new Date().toISOString().replace(/\.\d+Z$/, 'Z'));
let snap = plant.snapshot(), storyVisible = true, active = 'overview', storyFault = 'none';
story.setSnapshot(snap);

const panels = Object.fromEntries([...storyEl.querySelectorAll('[data-chapter]')].map(p => [p.dataset.chapter, p]));
const outcomes = [...storyEl.querySelectorAll('[data-outcome]')];
const bar = storyEl.querySelector('[data-story-bar]');

function stepStory() {
  snap = plant.step(1);
  story.setSnapshot(snap);
  for (const o of outcomes) o.classList.toggle('is-on', o.dataset.outcome === (snap.decision.state === 'REUSE' ? 'REUSE' : 'HOLD'));
}
new IntersectionObserver(([e]) => { storyVisible = e.isIntersecting; }).observe(storyEl);
setInterval(() => { if (storyVisible && !document.hidden) stepStory(); }, 1000);

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function setProgress(p) {
  const n = CHAPTERS.length, x = Math.min(p * n, n - 1e-4), i = Math.floor(x), f = x - i;
  const chapter = CHAPTERS[i], next = CHAPTERS[Math.min(i + 1, n - 1)];
  if (chapter !== active) {
    panels[active]?.classList.remove('is-active');
    panels[chapter].classList.add('is-active');
    story.highlight(FOCUS[chapter]);
    active = chapter;
  }
  story.goTo(STOP[chapter], STOP[next], smooth(0.5, 1, f));
  // In the decision chapter the water turns bad halfway, so the valve is seen to close.
  const fault = chapter === 'decide' && f > 0.45 ? 'turbidity' : 'none';
  if (fault !== storyFault) { storyFault = fault; plant.setFault(fault); stepStory(); }
  bar.style.transform = `scaleX(${p})`;
}
ScrollTrigger.create({ trigger: storyEl, start: 'top top', end: 'bottom bottom', scrub: true, onUpdate: self => setProgress(self.progress) });
setProgress(0);
if (import.meta.env.DEV) window.__wareva = { story, setProgress };

// Live control room, gentle reveals, language ---------------------------------------
const control = mountControlRoom(document.querySelector('[data-control]'), lang);

if (!reduceMotion) {
  gsap.from('.panel--hero > *', { y: 34, opacity: 0, duration: 1.1, stagger: 0.09, ease: 'power3.out', delay: 0.15 });
  for (const group of document.querySelectorAll('[data-reveal]')) {
    gsap.from(group.children.length > 1 ? group.children : group, {
      y: 28, opacity: 0, duration: 0.9, stagger: 0.07, ease: 'power3.out',
      scrollTrigger: { trigger: group, start: 'top 84%', once: true },
    });
  }
}

document.querySelector('[data-lang-toggle]').addEventListener('click', () => {
  lang = lang === 'ar' ? 'en' : 'ar';
  applyLang(lang);
  story.setLang(lang);
  story.setLabels(labelText(lang));
  frameStory();
  control.setLang(lang);
  ScrollTrigger.refresh();
});
