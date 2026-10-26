import { getSound } from 'https://esm.sh/wiktionary-sound';

const API_URL = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
const STORAGE_KEY = 'wordly-favorites';

const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
const heroForm = document.getElementById('hero-form');
const heroInput = document.getElementById('hero-input');
const resultsEl = document.getElementById('results');
const messageEl = document.getElementById('message');
const favoritesList = document.getElementById('favorites-list');
const favoritesEmpty = document.getElementById('favorites-empty');


function el(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function showMessage(text) {
  messageEl.textContent = text;
  messageEl.classList.remove('hidden');
}

function clearMessage() {
  messageEl.textContent = '';
  messageEl.classList.add('hidden');
}


function getFavorites() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveFavorites(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    showMessage('Could not save this word. Your browser may be blocking storage.');
  }
}

function isFavorite(word) {
  return getFavorites().includes(word.toLowerCase());
}

function toggleFavorite(word) {
  const key = word.toLowerCase();
  const favs = getFavorites();
  const next = favs.includes(key) ? favs.filter((w) => w !== key) : [...favs, key];
  saveFavorites(next);
  renderFavorites();
}

function renderFavorites() {
  const favs = getFavorites();
  favoritesList.replaceChildren();
  favoritesEmpty.classList.toggle('hidden', favs.length > 0);

  favs.forEach((word) => {
    const item = el('li', 'flex items-center overflow-hidden rounded-full bg-amber-100 text-amber-900');

    const open = el('button', 'px-4 py-2 font-semibold hover:bg-amber-200', word);
    open.type = 'button';
    open.addEventListener('click', () => runSearch(word));

    const remove = el('button', 'px-3 py-2 hover:bg-amber-200', '×');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Remove ${word} from saved words`);
    remove.addEventListener('click', () => {
      toggleFavorite(word);
      const star = document.getElementById('fav-btn');
      if (star && star.dataset.word === word) updateStar(star, word);
    });

    item.append(open, remove);
    favoritesList.append(item);
  });
}
const MAX_ATTEMPTS = 3;
const TIMEOUT_MS = 8000;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchOnce(word) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(API_URL + encodeURIComponent(word), { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
async function fetchWord(word) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetchOnce(word);

      if (response.status === 404) {
        const err = new Error('not-found');
        err.code = 'not-found';
        throw err;
      }
      if (response.ok) return await response.json();

      lastError = new Error('bad-response');
      lastError.code = 'bad-response';
    } catch (err) {
      if (err.code === 'not-found') throw err;
      lastError = err; 
    }

    if (attempt < MAX_ATTEMPTS) await wait(500 * attempt);
  }

  throw lastError;
}

function parseEntries(entries) {
  const first = entries[0];

  const phoneticItems = entries.flatMap((e) => e.phonetics || []);
  const text = first.phonetic || (phoneticItems.find((p) => p.text) || {}).text || '';
  
  const audioList = [
    ...new Set(
      phoneticItems
        .map((p) => p.audio)
        .filter((url) => url && url.trim().length > 10) 
        .map((url) => {
          if (url.startsWith('//')) return 'https:' + url;
          return url.replace(/^http:/, 'https:');
        })
    ),
  ];

  const meanings = entries.flatMap((e) => e.meanings || []).map((m) => {
    const synonyms = new Set(m.synonyms || []);
    (m.definitions || []).forEach((d) => (d.synonyms || []).forEach((s) => synonyms.add(s)));
    return {
      partOfSpeech: m.partOfSpeech || '',
      definitions: (m.definitions || []).slice(0, 3), 
      synonyms: [...synonyms].slice(0, 8),
    };
  });

  const sources = [...new Set(entries.flatMap((e) => e.sourceUrls || []))];

  return { word: first.word, phonetic: text, audioList, meanings, sources };
}

let currentAudio = null;

function tryPlay(url) {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    let settled = false;

    const cleanup = () => {
      audio.removeEventListener('canplaythrough', onReady);
      audio.removeEventListener('error', onError);
      clearTimeout(timer);
    };

    const onReady = () => {
      if (settled) return;
      settled = true;
      cleanup();
      audio.play().then(() => resolve(audio)).catch(reject);
    };

    const onError = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('audio-load-failed'));
    };

    audio.addEventListener('canplaythrough', onReady);
    audio.addEventListener('error', onError);
    audio.preload = 'auto';
    audio.src = url;
    audio.load();

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('audio-timeout'));
    }, 5000);
  });
}

async function playFirstWorking(urls, fallbackWord) {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }

  // 1. Try the URLs provided by the dictionary API
  for (const url of urls) {
    try {
      currentAudio = await tryPlay(url);
      return true;
    } catch (err) {
      console.warn('Dictionary audio failed:', url, err);
    }
  }

  
  if (fallbackWord) {
    try {
      console.info('Trying Wiktionary fallback for:', fallbackWord);
      const result = await getSound(fallbackWord, "en");
      
      if (result && result.best && result.best.url) {
        console.info('Found Wiktionary audio:', result.best.url);
        currentAudio = await tryPlay(result.best.url);
        return true;
      } else {
        console.warn('Wiktionary returned no audio for:', fallbackWord);
      }
    } catch (err) {
      console.warn('Wiktionary fallback failed:', err);
    }
  }

  return false;
}
function updateStar(button, word) {
  const saved = isFavorite(word);
  button.setAttribute('aria-pressed', String(saved));
  button.setAttribute('aria-label', saved ? `Remove ${word} from saved words` : `Save ${word}`);
  button.textContent = saved ? '★' : '☆';
  button.className =
    'grid h-11 w-11 place-items-center rounded-full text-xl transition ' +
    (saved ? 'bg-amber-400 text-white' : 'bg-ink/5 text-ink hover:bg-amber-100');
  const card = document.getElementById('result-card');
  if (card) {
    card.classList.toggle('ring-2', saved);
    card.classList.toggle('ring-amber-400', saved);
    card.classList.toggle('ring-1', !saved);
    card.classList.toggle('ring-ink/5', !saved);
  }
}

function renderResult(data) {
  const card = el('article', 'rounded-3xl bg-white p-8 shadow-xl shadow-ink/10');
  card.id = 'result-card';
  const header = el('div', 'flex items-start justify-between gap-4');
  const titleBox = el('div');
  titleBox.append(el('h3', 'text-4xl font-extrabold tracking-tight', data.word));
  titleBox.append(el('p', 'mt-1 text-sm text-ink/60', data.phonetic || 'No phonetic spelling available.'));

  const actions = el('div', 'flex items-center gap-2');

  if (data.audioList.length) {
    const play = el('button', 'grid h-11 w-11 place-items-center rounded-full bg-teal-brand/10 text-teal-brand transition hover:bg-teal-brand hover:text-white', '▶');
    play.type = 'button';
    play.setAttribute('aria-label', `Play pronunciation of ${data.word}`);
    play.addEventListener('click', async () => {
      clearMessage();
      // Pass data.word as the fallback argument
      const ok = await playFirstWorking(data.audioList, data.word);
      if (!ok) showMessage('This pronunciation could not be loaded. The audio file may be unavailable.');
    });
    actions.append(play);
  } else {
    actions.append(el('span', 'text-sm text-ink/50', 'No audio available'));
  }

  const star = el('button');
  star.id = 'fav-btn';
  star.type = 'button';
  star.dataset.word = data.word.toLowerCase();
  star.addEventListener('click', () => {
    toggleFavorite(data.word);
    updateStar(star, data.word);
  });
  actions.append(star);

  header.append(titleBox, actions);
  card.append(header);

  data.meanings.forEach((m) => {
    const block = el('section', 'mt-6');
    block.append(el('p', 'text-sm font-semibold italic text-teal-brand', m.partOfSpeech || 'unknown'));

    const list = el('ol', 'mt-2 list-decimal space-y-3 pl-5');
    m.definitions.forEach((d) => {
      const li = el('li', 'text-ink/85', d.definition);
      if (d.example) li.append(el('p', 'mt-1 border-l-2 border-teal-brand/40 pl-3 text-sm text-ink/60', `“${d.example}”`));
      list.append(li);
    });
    block.append(list);

    const syn = el('p', 'mt-3 text-sm');
    syn.append(el('span', 'font-semibold', 'Synonyms: '));
    syn.append(document.createTextNode(m.synonyms.length ? m.synonyms.join(', ') : 'No synonyms available.'));
    block.append(syn);

    card.append(block);
  });


  if (data.sources.length) {
    const src = el('p', 'mt-6 text-sm text-ink/60');
    src.append(document.createTextNode('Source: '));
    data.sources.forEach((url) => {
      const a = el('a', 'underline hover:text-teal-brand', url);
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      src.append(a);
    });
    card.append(src);
  }

  resultsEl.replaceChildren(card);
  updateStar(star, data.word);
}

async function runSearch(rawWord) {
  const word = rawWord.trim();
  clearMessage();

  if (!word) {
    showMessage('Enter a word to search.');
    return;
  }
  if (!/^[\p{L}'’-]+$/u.test(word)) {
    showMessage('Use letters only. Numbers and symbols are not supported.');
    return;
  }

  searchInput.value = word;
  resultsEl.replaceChildren(el('p', 'p-10 text-center text-ink/60', 'Searching…'));

  try {
    const entries = await fetchWord(word);
    renderResult(parseEntries(entries));
  } catch (err) {
    resultsEl.replaceChildren();
    if (err.code === 'not-found') {
      showMessage(`No definitions found for “${word}”. Check the spelling or try another word.`);
    } else if (err.code === 'bad-response') {
      showMessage('The dictionary service had a problem. Try again in a moment.');
    } else {
      showMessage('Could not reach the dictionary service. Check your internet connection and try again.');
    }
  }
}

searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  runSearch(searchInput.value);
});

heroForm.addEventListener('submit', (e) => {
  e.preventDefault();
  document.getElementById('search').scrollIntoView({ behavior: 'smooth' });
  runSearch(heroInput.value);
});

renderFavorites();