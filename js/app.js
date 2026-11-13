/* ============================================================
   APP 부트스트랩
   - 각 모듈(mixin)을 NovelArchiveApp.prototype 에 병합
   - 하나의 app 인스턴스 생성
   ============================================================ */

// 병합 대상 mixin들 (로드 순서는 상관 없음 — 모두 prototype 확장만 하므로)
const MIXINS = [
    PreferencesMixin,
    FileSyncMixin,
    ModalMixin,
    ListViewMixin,
    DetailViewMixin,
    ChapterEditMixin,
    SettingEditMixin,
	CommentMixin,
];

class NovelArchiveApp {
    constructor() {
		this._isBackingUp = false;
        this.db = new NovelDatabase();

        this.novels = [];
        this.currentNovel = null;

        this.currentView = 'list';
        this.selectedNovelId = null;
        this.selectedChapterIndex = 0;
        this.selectedSettingIndex = 0;
        this.activeDetailTab = 'chapters';
		
		this.currentPage = 1;          // 현재 페이지 (1부터 시작)
        this.itemsPerPage = 16;        // 페이지당 항목 수
		
        this.searchQuery = '';
        this.selectedTag = '전체';
		this.selectedStatus = 'all';
		this.selectedAdult = 'all';
        this.sortOrder = 'latest';

        this.isDarkMode = false;
        this.fontSize = 13;
        this.fontFamily = 'font-nanumgothic';
        this.lineHeight = '180%';
		this.contentPadding = 16;

        this.lastInput = { color: '#f8c8dc', title: '', keyword: '' };

        this.tagCache = { counts: {}, allTags: [] };
        this._lastFilteredIds = null;

        this.autoSaveTimer = null;
        this.fileSaveTimer = null;
        this.isComposing = false;

        this.fileHandle = null;
        /* ★ P0: 회차 본문 캐시 (Map<novelId:chapterIdx, chapterFullObject>) */
        this._chapterContentCache = new Map();
        this._chapterCacheOrder = [];      // LRU 순서
        this._chapterCacheLimit = 3;       // 동시 유지 회차 수
        // 초기화 (initApp은 async지만 await 없이 진행 — 기존과 동일)
        this.initTheme();
        this.initPreferences();
        this.initEventDelegation();
        this.initApp();
        this.initGlobalKeyEvents();
        this.initVisibilitySave();
		this.initLiveClock();
    }
	
	/* 최근 본 작품/회차 위치 기억 */
    rememberPosition() {
        try {
            if (this.selectedNovelId) {
                localStorage.setItem('novel_archive_last_novel', String(this.selectedNovelId));
                localStorage.setItem('novel_archive_last_chapter', String(this.selectedChapterIndex));
            }
        } catch (e) {}
    }

    /* ---------------- 앱 초기화 (mixin에 없는 것만 여기에) ---------------- */
    async initApp() {
        try {
            await this.db.init();
            let allMetas = await this.db.getAllMetas();
			const commentCounts = await this.db.getCommentCountsByNovel();
for (const m of allMetas) m.commentCount = commentCounts[m.id] || 0;

            if (allMetas.length === 0) {
                const nowISO = new Date().toISOString();
                const seed = [{
                    id: 1,
                    color: '#f8c8dc',
                    title: '샘플 텍스트',
                    keyword: '장르, 테마',
                    targetChars: 5000,
                    settings: [
                        { title: '세계관 설정', content: '# 제목1\n## 제목2\n### 제목3\n#### 제목4\n**굵은 글씨**는 이렇게 뜹니다.\n*기울임*은 이렇게 뜹니다.\n`형광펜`은 이렇게 뜹니다.\n> 인용은 이렇게\n---\n|번호|내용|설명|\n|:---:|:---:|---|\n|표는|이렇게|작성할 수 있습니다|' },
                    ],
                    chapters: [{
                        title: '1. 시작',
                        content: '내용을 작성하십시오.',
                        createdAt: nowISO, updatedAt: nowISO,
                    }],
                    createdAt: nowISO, updatedAt: nowISO,
                }];
                await this.db.saveAllNovels(seed);
                allMetas = await this.db.getAllMetas();
            } else {
                for (const m of allMetas) {
                    if (m.chapterCount === undefined) m.chapterCount = 0;
                    if (m.totalChars === undefined) m.totalChars = 0;
                    if (m.hasRichSettings === undefined) m.hasRichSettings = false;
                    if (!m.createdAt) m.createdAt = new Date().toISOString();
                    if (!m.updatedAt) m.updatedAt = m.createdAt;
                }
            }

this.novels = allMetas;
try {
    const commentCounts = await this.db.getCommentCountsByNovel();
    for (const m of this.novels) m.commentCount = commentCounts[m.id] || 0;
} catch (e) {
    console.warn('[initApp] 댓글 카운트 로드 실패:', e);
    for (const m of this.novels) m.commentCount = 0;
}
this.rebuildTagCache();

try {
    const lastMem = localStorage.getItem('novel_archive_last_input');
    if (lastMem) this.lastInput = JSON.parse(lastMem);
} catch (e) {
    console.warn('[initApp] lastInput 복원 실패:', e);
    this.lastInput = { color: '#f8c8dc', title: '', keyword: '' };
}

this.render();
this.updateGlobalStats();

            setTimeout(() => this._migrateRichSettingsFlags(), 0);
			setTimeout(() => this._checkPendingDraft(), 100);
        } catch (e) {
            console.error('초기화 실패:', e);
        }
    }

    /* ★ P0: 회차 본문 캐시 헬퍼 */
    _cacheKey(novelId, idx) { return `${novelId}:${idx}`; }

    _getCachedChapter(novelId, idx) {
        const key = this._cacheKey(novelId, idx);
        const ch = this._chapterContentCache.get(key);
        if (ch) {
            // LRU 갱신
            this._chapterCacheOrder = this._chapterCacheOrder.filter(k => k !== key);
            this._chapterCacheOrder.push(key);
        }
        return ch || null;
    }

    _putCachedChapter(novelId, idx, ch) {
        const key = this._cacheKey(novelId, idx);
        this._chapterContentCache.set(key, ch);
        this._chapterCacheOrder = this._chapterCacheOrder.filter(k => k !== key);
        this._chapterCacheOrder.push(key);
        while (this._chapterCacheOrder.length > this._chapterCacheLimit) {
            const oldKey = this._chapterCacheOrder.shift();
            this._chapterContentCache.delete(oldKey);
        }
    }

    _evictChapterCache(novelId, idx) {
        const key = this._cacheKey(novelId, idx);
        this._chapterContentCache.delete(key);
        this._chapterCacheOrder = this._chapterCacheOrder.filter(k => k !== key);
    }

    /* ★ P0: 회차 본문 보장 로드 (없으면 DB에서 가져옴) */
    async ensureChapterLoaded(novelId, idx) {
        const cached = this._getCachedChapter(novelId, idx);
        if (cached) return cached;
        const ch = await this.db.getChapter(novelId, idx);
        if (!ch) return null;
        const full = {
            title: ch.title || '',
            content: ch.content || '',
            createdAt: ch.createdAt,
            updatedAt: ch.updatedAt,
        };
        this._putCachedChapter(novelId, idx, full);
        return full;
    }

    /* ★ P0: 복원 전 스냅샷 (localStorage, 작품 단위 요약) */
    _snapshotBeforeRestore(reason = 'restore') {
        try {
            const metas = this.novels.map(n => ({
                id: n.id, title: n.title,
                chapterCount: n.chapterCount || 0,
                totalChars: n.totalChars || 0,
                updatedAt: n.updatedAt,
            }));
            localStorage.setItem('novel_archive_last_snapshot', JSON.stringify({
                reason,
                at: new Date().toISOString(),
                metas,
            }));
        } catch (e) {
            console.warn('[snapshot] 실패:', e);
        }
    }


    async _checkPendingDraft() {
        try {
            const raw = localStorage.getItem('novel_archive_draft');
            if (!raw) return;
            const draft = JSON.parse(raw);
            if (!draft || !draft.novelId || typeof draft.content !== 'string') return;

            // 저장된 DB 내용과 비교
            const savedCh = await this.db.getChapter(draft.novelId, draft.chapterIndex);
            const savedContent = savedCh ? (savedCh.content || '') : '';
            if (savedContent === draft.content) {
                this._clearDraft?.();
                return;
            }
            const ok = confirm(
                `이전에 저장하지 못한 편집 내용이 있습니다.\n` +
                `(작품 #${draft.novelId}, ${draft.chapterIndex + 1}번째 회차, ${draft.savedAt})\n` +
                `복원할까요?`
            );
            if (!ok) { this._clearDraft?.(); return; }

            // 해당 작품/회차로 이동 후 메모리 content 덮어쓰기
            await this.goToDetail(draft.novelId);
            if (this.currentNovel && this.currentNovel.chapters[draft.chapterIndex]) {
                this.currentNovel.chapters[draft.chapterIndex].content = draft.content;
                this.selectedChapterIndex = draft.chapterIndex;
                this.render();
                this._setSaveStatus?.('saving');
                await this._flushPendingAutoSave?.();
            }
            this._clearDraft?.();
        } catch (e) {
            console.warn('[draft] 복원 실패:', e);
        }
    }
    async _migrateRichSettingsFlags() {
        try {
            const updated = await this.db.refreshRichSettingsFlags();
            if (updated > 0) {
                this.novels = await this.db.getAllMetas();
                for (const m of this.novels) {
                    if (m.hasRichSettings === undefined) m.hasRichSettings = false;
                    if (m.chapterCount === undefined) m.chapterCount = 0;
                    if (m.totalChars === undefined) m.totalChars = 0;
                }
                if (this.currentView === 'list') this.render();
                console.log(`[마이그레이션] 🏷️ hasRichSettings 갱신: ${updated}개`);
            }
        } catch (e) {
            console.error('hasRichSettings 마이그레이션 실패:', e);
        }
    }
}

/* ── mixin 병합 ── */
for (const mixin of MIXINS) {
    for (const key of Object.keys(mixin)) {
        NovelArchiveApp.prototype[key] = mixin[key];
    }
}

/* ── 부트스트랩 ── */
const app = new NovelArchiveApp();