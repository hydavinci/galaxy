import starsData from '../data/stars-data.json';
import { CONSTELLATIONS } from '../data/constellations';

interface SearchResult {
  name: string;
  type: 'star' | 'planet' | 'constellation';
  ra: number;
  dec: number;
  icon: string;
}

const PLANET_NAMES = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'];

const searchInput = document.getElementById('search') as HTMLInputElement;
const dropdown = document.createElement('div');
dropdown.id = 'search-dropdown';
dropdown.style.cssText = `position:absolute;top:42px;left:50%;transform:translateX(-50%);width:260px;max-height:240px;overflow-y:auto;background:rgba(15,20,40,0.95);border:1px solid rgba(100,140,255,0.3);border-radius:8px;display:none;z-index:100;`;
searchInput.parentElement!.appendChild(dropdown);

function search(query: string): SearchResult[] {
  if (!query) return [];
  const q = query.toLowerCase();
  const results: SearchResult[] = [];

  // Stars
  for (const s of starsData as any[]) {
    if (s.name.toLowerCase().includes(q)) {
      results.push({ name: s.name, type: 'star', ra: s.ra, dec: s.dec, icon: '⭐' });
    }
    if (results.length > 20) break;
  }

  // Planets
  for (const p of PLANET_NAMES) {
    if (p.toLowerCase().includes(q)) {
      // Get live planet position from engine
      const pos = (window as any).__planetPositions?.[p];
      const ra = pos?.ra ?? 0;
      const dec = pos?.dec ?? 0;
      results.push({ name: p, type: 'planet', ra, dec, icon: '🪐' });
    }
  }

  // Constellations
  for (const c of CONSTELLATIONS) {
    if (c.name.toLowerCase().includes(q) || c.abbr.toLowerCase().includes(q)) {
      // Use center of first line as position
      const [ra1, dec1] = c.lines[0] || [0, 0, 0, 0];
      results.push({ name: c.name, type: 'constellation', ra: ra1, dec: dec1, icon: '⛺' });
    }
  }

  return results.slice(0, 10);
}

function showResults(results: SearchResult[]) {
  if (results.length === 0) { dropdown.style.display = 'none'; return; }
  dropdown.innerHTML = results.map((r, i) => `
    <div class="search-result" data-idx="${i}" style="padding:8px 12px;cursor:pointer;color:#cdf;font-size:13px;display:flex;align-items:center;gap:8px;border-bottom:1px solid rgba(100,140,255,0.1);">
      <span>${r.icon}</span><span>${r.name}</span><span style="margin-left:auto;font-size:11px;opacity:0.5;">${r.type}</span>
    </div>
  `).join('');
  dropdown.style.display = 'block';

  dropdown.querySelectorAll('.search-result').forEach((el, i) => {
    el.addEventListener('click', () => selectResult(results[i]));
    el.addEventListener('mouseenter', () => (el as HTMLElement).style.background = 'rgba(60,80,140,0.4)');
    el.addEventListener('mouseleave', () => (el as HTMLElement).style.background = '');
  });
}

function selectResult(r: SearchResult) {
  dropdown.style.display = 'none';
  searchInput.value = r.name;
  searchInput.blur();
  // For planets, get live position at dispatch time
  let ra = r.ra, dec = r.dec;
  if (r.type === 'planet') {
    const pos = (window as any).__planetPositions?.[r.name];
    if (pos) { ra = pos.ra; dec = pos.dec; }
  }
  // Direct call as fallback
  const eng = (window as any).__engine;
  if (eng) {
    eng.getCamera().lookAt(ra, dec);
    eng.showInfo({ name: r.name, type: r.type === 'planet' ? 'Planet' : r.type === 'star' ? 'Star' : 'Constellation', ra, dec });
  } else {
    window.dispatchEvent(new CustomEvent('goto-star', { detail: { ra, dec } }));
  }
}

searchInput.addEventListener('input', () => {
  const results = search(searchInput.value);
  showResults(results);
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const results = search(searchInput.value);
    if (results.length > 0) selectResult(results[0]);
  }
  if (e.key === 'Escape') {
    dropdown.style.display = 'none';
    searchInput.blur();
  }
});

searchInput.addEventListener('blur', () => {
  setTimeout(() => dropdown.style.display = 'none', 200);
});
