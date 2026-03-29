/**
 * Build words8.js and scrabble_ranks8.js from WOW24 lexicon + en_full.txt usage.
 * Run: node scripts/build-words8.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function loadFreqMap() {
    const text = fs.readFileSync(path.join(root, 'en_full.txt'), 'utf8');
    const map = new Map();
    for (const line of text.split('\n')) {
        const sp = line.trim().split(/\s+/);
        if (sp.length >= 2) {
            const w = sp[0].toLowerCase();
            const f = parseInt(sp[1], 10);
            if (w && !isNaN(f)) map.set(w, f);
        }
    }
    return map;
}

// Standard English Scrabble tile counts (98 tiles; blanks omitted for ordering)
const TILES = {
    a: 9, b: 2, c: 2, d: 4, e: 12, f: 2, g: 3, h: 2, i: 9, j: 1, k: 1, l: 4, m: 2,
    n: 6, o: 8, p: 2, q: 1, r: 6, s: 4, t: 6, u: 4, v: 2, w: 2, x: 1, y: 2, z: 1
};

function playabilityScore(word) {
    let s = 0;
    for (const ch of word) {
        const n = TILES[ch] || 1;
        s += Math.log(n);
    }
    return s;
}

function main() {
    const wowPath = process.argv[2] || '/tmp/WOW24.txt';
    const raw = fs.readFileSync(wowPath, 'utf8');
    const wow8 = new Set();
    for (const line of raw.split('\n')) {
        const w = line.trim().toLowerCase();
        if (w.length === 8 && /^[a-z]+$/.test(w)) wow8.add(w);
    }
    const words = [...wow8].sort();
    const freq = loadFreqMap();

    const withMeta = words.map((w) => ({
        w,
        freq: freq.get(w) ?? 0,
        play: playabilityScore(w)
    }));

    withMeta.sort((a, b) => {
        if (b.freq !== a.freq) return b.freq - a.freq;
        if (a.w < b.w) return -1;
        if (a.w > b.w) return 1;
        return 0;
    });

    const WORDS8 = withMeta.map((x) => x.w);

    const byPlay = [...withMeta].sort((a, b) => {
        if (b.play !== a.play) return b.play - a.play;
        if (a.w < b.w) return -1;
        if (a.w > b.w) return 1;
        return 0;
    });
    const rankByWord = new Map();
    byPlay.forEach((x, i) => rankByWord.set(x.w, i + 1));

    const SCRABBLE_RANKS8 = WORDS8.map((w) => rankByWord.get(w));

    const esc = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const jsonWords = WORDS8.map((w) => `"${esc(w)}"`).join(',');
    const jsonRanks = SCRABBLE_RANKS8.join(',');

    fs.writeFileSync(
        path.join(root, 'words8.js'),
        `const WORDS8 = [${jsonWords}];\n`
    );
    fs.writeFileSync(
        path.join(root, 'scrabble_ranks8.js'),
        `const SCRABBLE_RANKS8 = [${jsonRanks}];\n`
    );

    console.log('WORDS8 length', WORDS8.length);
    console.log('Sample', WORDS8.slice(0, 3), SCRABBLE_RANKS8.slice(0, 3));
}

main();
