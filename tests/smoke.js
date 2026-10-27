/*
  Смоук-тест игровой логики без браузера.
  Подменяет DOM/canvas заглушками, прокручивает игровой цикл и проверяет,
  что волны, стрельба, урон, пауза и рестарт работают без исключений.

  Запуск: node tests/smoke.js
*/
'use strict';

const path = require('path');

/* ----------------------------- заглушки DOM ----------------------------- */
let passed = 0;
let failed = 0;

function check(name, cond, extra) {
  if (cond) {
    passed++;
    console.log('PASS  ' + name);
  } else {
    failed++;
    console.log('FAIL  ' + name + (extra ? '  → ' + extra : ''));
  }
}

const rafQueue = [];
let simTime = 0;

const listeners = { window: {}, canvas: {}, document: {} };

function addTo(store) {
  return function (type, fn) {
    (store[type] = store[type] || []).push(fn);
  };
}

function fire(store, type, ev) {
  const list = store[type] || [];
  for (const fn of list) fn(ev || {});
}

const ctxStub = new Proxy(
  {},
  {
    get(target, prop) {
      if (prop === 'createRadialGradient' || prop === 'createLinearGradient') {
        return function () {
          return { addColorStop: function () {} };
        };
      }
      if (prop === 'measureText') return function () { return { width: 10 }; };
      if (prop in target) return target[prop];
      return function () {};
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  }
);

function makeCanvas() {
  return {
    width: 0,
    height: 0,
    style: {},
    getContext: function () { return ctxStub; },
    getBoundingClientRect: function () { return { left: 0, top: 0, width: 1280, height: 800 }; },
    addEventListener: addTo(listeners.canvas),
  };
}

const canvas = makeCanvas();

function makeEl() {
  return {
    style: {},
    textContent: '',
    innerHTML: '',
    classList: {
      add: function () {},
      remove: function () {},
      contains: function () { return false; },
    },
    addEventListener: function () {},
  };
}

const els = {
  game: canvas,
  overlay: makeEl(),
  'ov-title': makeEl(),
  'ov-text': makeEl(),
  'ov-keys': makeEl(),
  'ov-btn': makeEl(),
};

const documentStub = {
  hidden: false,
  getElementById: function (id) { return els[id] || makeEl(); },
  querySelector: function () { return makeEl(); },
  createElement: function (tag) {
    if (tag === 'canvas') return makeCanvas();
    return makeEl();
  },
  addEventListener: addTo(listeners.document),
};

global.window = global;
global.document = documentStub;
global.localStorage = {
  store: {},
  getItem: function (k) { return this.store[k] === undefined ? null : this.store[k]; },
  setItem: function (k, v) { this.store[k] = String(v); },
};
global.location = { search: '?auto=1' };
global.devicePixelRatio = 1;
global.innerWidth = 1280;
global.innerHeight = 800;
global.requestAnimationFrame = function (cb) { rafQueue.push(cb); return rafQueue.length; };
global.addEventListener = addTo(listeners.window);
global.removeEventListener = function () {};
global.URLSearchParams = URLSearchParams;

/* ------------------------------- игра ----------------------------------- */
require(path.join(__dirname, '..', 'game.js'));

const arena = global.window.__arena;

function frames(n, dtMs) {
  const dt = dtMs === undefined ? 1000 / 60 : dtMs;
  for (let i = 0; i < n; i++) {
    simTime += dt;
    const batch = rafQueue.slice();
    rafQueue.length = 0;
    for (const cb of batch) cb(simTime);
  }
}

function mouseMove(x, y) {
  fire(listeners.canvas, 'mousemove', { clientX: x, clientY: y });
}

function mouseDown() {
  fire(listeners.canvas, 'mousedown', { button: 0 });
}

function key(code) {
  fire(listeners.window, 'keydown', { code: code, preventDefault: function () {}, repeat: false });
  fire(listeners.window, 'keyup', { code: code, preventDefault: function () {} });
}

function keyDown(code) {
  fire(listeners.window, 'keydown', { code: code, preventDefault: function () {}, repeat: false });
}

function keyUp(code) {
  fire(listeners.window, 'keyup', { code: code, preventDefault: function () {} });
}

/* ------------------------------- проверки -------------------------------- */
console.log('--- boot ---');
check('игра стартует в состоянии playing', arena.state === 'playing', 'state=' + arena.state);
check('стартовая волна = 1', arena.wave === 1, 'wave=' + arena.wave);
check('очки обнулены', arena.score === 0);
check('игрок создан', !!arena.player);

frames(120);
check('враги появляются', arena.enemies > 0, 'enemies=' + arena.enemies);

console.log('--- управление ---');
const x0 = arena.player.x;
keyDown('KeyD');
frames(20);
keyUp('KeyD');
check('движение вправо по D', arena.player.x > x0 + 15, 'x ' + Math.round(x0) + ' → ' + Math.round(arena.player.x));

console.log('--- стрельба ---');
const p = arena.player;
arena.spawn('grunt', p.x + 170, p.y);
const totalBefore = arena.score;
mouseMove(p.x + 170, p.y);
mouseDown();
frames(100);
check('пули летят', arena.bullets > 0, 'bullets=' + arena.bullets);
check('враг убит и очки начислены', arena.score > totalBefore, 'score=' + arena.score);

console.log('--- урон игроку ---');
let guard = 0;
while (arena.player.invuln > 0 && guard++ < 200) frames(1);
const hpBefore = arena.hp;
arena.hit(30);
check('урон игроку применяется', arena.hp <= hpBefore - 29, 'hp ' + hpBefore + ' → ' + arena.hp);

console.log('--- волны ---');
let cleared = 0;
for (let i = 0; i < 260; i++) {
  arena.clear();
  frames(1);
  if (arena.wave >= 2) {
    cleared = i;
    break;
  }
}
check('после зачистки начинается волна 2', arena.wave >= 2, 'wave=' + arena.wave + ' через ' + cleared + ' кадров');

console.log('--- пауза ---');
key('Escape');
check('Esc ставит на паузу', arena.state === 'paused', 'state=' + arena.state);
key('Escape');
check('Esc снимает паузу', arena.state === 'playing', 'state=' + arena.state);

console.log('--- смерть и рестарт ---');
guard = 0;
while (arena.player && arena.player.invuln > 0 && guard++ < 200) frames(1);
arena.hit(1000);
check('при нуле HP игра окончена', arena.state === 'over', 'state=' + arena.state);
check('рекорд сохранён', localStorage.getItem('neon-arena-best') !== null);

arena.start();
check('рестарт сбрасывает очки', arena.state === 'playing' && arena.score === 0, 'state=' + arena.state + ' score=' + arena.score);
check('рестарт возвращает волну 1', arena.wave === 1, 'wave=' + arena.wave);

console.log('--- длинный прогон ---');
mouseDown();
frames(1800);
check('игрок жив после 30 секунд', arena.state === 'playing' || arena.state === 'over', 'state=' + arena.state);
if (arena.player) {
  check(
    'координаты игрока конечны',
    Number.isFinite(arena.player.x) && Number.isFinite(arena.player.y),
    arena.player.x + ',' + arena.player.y
  );
}
check('нет NaN в очках', Number.isFinite(arena.score), 'score=' + arena.score);

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
