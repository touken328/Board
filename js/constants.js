/* ============================================================
   CONSTANTS
   ============================================================ */
const COLOR_PALETTE = [
    { id: 'rose',     name: '로즈',   hex: '#f67280' },
    { id: 'pink',     name: '핑크',   hex: '#f8c8dc' },
    { id: 'coral',    name: '코랄',   hex: '#f8b195' },
    { id: 'lavender', name: '퍼플',   hex: '#e2d4f0' },
    { id: 'chacol',   name: '차콜',   hex: '#b5bad3' },
    { id: 'blue',     name: '블루',   hex: '#92bef1' },
    { id: 'sky',      name: '하늘',   hex: '#c0e1fb' },
    { id: 'mint',     name: '민트',   hex: '#b8e0d2' },
    { id: 'green',    name: '그린',   hex: '#d0e084' },
    { id: 'gold',     name: '골드',   hex: '#d4af37' },
];

const RICH_SETTINGS_THRESHOLD = 100;

const COLOR_ORDER = COLOR_PALETTE.reduce((m, c, i) => {
    m[c.hex.toLowerCase()] = i;
    return m;
}, {});

const colorIndex = (hex) => {
    const i = COLOR_ORDER[(hex || '').toLowerCase()];
    return i === undefined ? COLOR_PALETTE.length : i;
};

const SORT_COMPARATORS = {
    latest:         (a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0),
    oldest_updated: (a, b) => new Date(a.updatedAt || a.createdAt || 0) - new Date(b.updatedAt || b.createdAt || 0),
    created_desc:   (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0),
    created_asc:    (a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0),
    color_asc:      (a, b) => (colorIndex(a.color) - colorIndex(b.color)) || (a.title || '').localeCompare(b.title || '', 'ko'),
    color_desc:     (a, b) => (colorIndex(b.color) - colorIndex(a.color)) || (b.title || '').localeCompare(a.title || '', 'ko'),
    title_asc:      (a, b) => (a.title || '').localeCompare(b.title || '', 'ko'),
    title_desc:     (a, b) => (b.title || '').localeCompare(a.title || '', 'ko'),
    chars_desc:     (a, b) => (b.totalChars || 0) - (a.totalChars || 0),
    chars_asc:      (a, b) => (a.totalChars || 0) - (b.totalChars || 0),
	chapters_desc:  (a, b) => (b.chapterCount || 0) - (a.chapterCount || 0),
    chapters_asc:   (a, b) => (a.chapterCount || 0) - (b.chapterCount || 0),
};

/* ============================================================
   FONT LAZY LOADER
   ============================================================ */
const FontLoader = {
    map: {
        'font-nanummyeongjo': { family: 'Nanum+Myeongjo:wght@400;700;800' },
        'font-ridibatang':    { css: 'https://cdn.jsdelivr.net/gh/ridenote/ridibatang/ridibatang.css' },
    },
    loaded: new Set(),
    ensure(fontClass) {
        const spec = this.map[fontClass];
        if (!spec || this.loaded.has(fontClass)) return;
        this.loaded.add(fontClass);
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = spec.css || `https://fonts.googleapis.com/css2?family=${spec.family}&display=swap`;
        document.head.appendChild(link);
    }
};

/* ============================================================
   NOVEL STATUS
   ============================================================ */
const NOVEL_STATUS = {
    ongoing:   { id: 'ongoing',   label: '연재', emoji: '📖', color: '#92bef1' },
    hiatus:    { id: 'hiatus',    label: '초고',   emoji: '📜', color: '#d4af37' },
    completed: { id: 'completed', label: '완결',   emoji: '💎', color: '#b8e0d2' },
    dropped:   { id: 'dropped',   label: '썰',   emoji: '🌠', color: '#b5bad3' },
};

const getStatusInfo = (id) => NOVEL_STATUS[id] || NOVEL_STATUS.ongoing;