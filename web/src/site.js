// WAREVA company site: smooth scroll, the scroll-driven story of one liter, and the live control room.
// Text, scrolling, the twin and the phone run first; the 3D code loads separately, so a device that
// cannot run it still gets the whole page.
import './polyfills.js';
import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import rules from '../../core/rules.json';
import { Plant } from '../../twin/plant.js';
import { mountControlRoom } from './controlroom.js';
import { STRINGS, applyLang, currentLang } from './i18n.js';
import { LOW_POWER } from './tone.js';

gsap.registerPlugin(ScrollTrigger);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let lang = currentLang();
applyLang(lang);

// Smooth scrolling on desktop, kept in step with ScrollTrigger. Phones keep their native scrolling.
let lenis = null;
if (!reduceMotion && !LOW_POWER) {
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
    else target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
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
const storyStage = document.querySelector('[data-story-stage]');
const plant = new Plant(rules, new Date().toISOString().replace(/\.\d+Z$/, 'Z'));
let snap = plant.snapshot(), storyVisible = true, active = 'overview', storyFault = 'none', story = null;
const shot = { a: 'overview', b: 'overview', f: 0 };

const panels = Object.fromEntries([...storyEl.querySelectorAll('[data-chapter]')].map(p => [p.dataset.chapter, p]));
const outcomes = [...storyEl.querySelectorAll('[data-outcome]')];
const bar = storyEl.querySelector('[data-story-bar]');

function stepStory() {
  snap = plant.step(1);
  story?.setSnapshot(snap);
  for (const o of outcomes) o.classList.toggle('is-on', o.dataset.outcome === (snap.decision.state === 'REUSE' ? 'REUSE' : 'HOLD'));
}
setInterval(() => { if (storyVisible && !document.hidden) stepStory(); }, 1000);

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function setProgress(p) {
  const n = CHAPTERS.length, x = Math.min(p * n, n - 1e-4), i = Math.floor(x), f = x - i;
  const chapter = CHAPTERS[i], next = CHAPTERS[Math.min(i + 1, n - 1)];
  if (chapter !== active) {
    panels[active]?.classList.remove('is-active');
    panels[chapter].classList.add('is-active');
    story?.highlight(FOCUS[chapter]);
    active = chapter;
  }
  Object.assign(shot, { a: STOP[chapter], b: STOP[next], f: smooth(0.5, 1, f) });
  story?.goTo(shot.a, shot.b, shot.f);
  // In the decision chapter the water turns bad halfway, so the valve is seen to close.
  const fault = chapter === 'decide' && f > 0.45 ? 'turbidity' : 'none';
  if (fault !== storyFault) { storyFault = fault; plant.setFault(fault); stepStory(); }
  bar.style.transform = `scaleX(${p})`;
}
ScrollTrigger.create({ trigger: storyEl, start: 'top top', end: 'bottom bottom', scrub: true, onUpdate: self => setProgress(self.progress) });
setProgress(0);

// Live control room -------------------------------------------------------------
const controlEl = document.querySelector('[data-control]');
const control = mountControlRoom(controlEl, lang);

// 3D: loaded on its own. Phones keep one GPU context at a time, owned by whichever section is on screen.
let createViewer = null;
const near = { story: true, control: false };
const no3d = () => document.documentElement.classList.add('no-3d');
const lost = stage => () => stage.classList.add('is-lost');

function makeStory() {
  if (story) return;
  story = createViewer(storyStage, { labels: labelText(lang), lang, onLost: lost(storyStage) });
  story.frame(lang === 'ar' ? 1 : -1);
  story.goTo(shot.a, shot.b, shot.f, false);
  story.highlight(FOCUS[active]);
  story.setSnapshot(snap);
}
function dropStory() { story?.dispose(); story = null; }

function arrange() {
  if (!createViewer) return;
  try {
    if (!LOW_POWER) {
      if (near.story) makeStory();
      if (near.control) control.attach(createViewer, lost(control.stage));
    } else if (near.control) {
      dropStory();
      control.attach(createViewer, lost(control.stage));
    } else if (near.story) {
      control.detach();
      makeStory();
    } else {
      dropStory();
      control.detach();
    }
  } catch {
    no3d();
  }
}
new IntersectionObserver(([e]) => { storyVisible = near.story = e.isIntersecting; arrange(); }).observe(storyEl);
new IntersectionObserver(([e]) => { near.control = e.isIntersecting; arrange(); }, { rootMargin: LOW_POWER ? '0px' : '300px 0px' }).observe(controlEl);
import('./scene/viewer.js').then(m => { createViewer = m.createViewer; arrange(); }).catch(no3d);

// Gentle reveals and language ----------------------------------------------------
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
  story?.setLang(lang);
  story?.setLabels(labelText(lang));
  story?.frame(lang === 'ar' ? 1 : -1);
  control.setLang(lang);
  ScrollTrigger.refresh();
});

if (import.meta.env.DEV) window.__wareva = { get story() { return story; }, setProgress, control, near, arrange };
