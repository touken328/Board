/* ============================================================
   DATABASE
   ============================================================ */
class NovelDatabase {
    constructor() {
        this.dbName = 'NovelArchiveDB';
        this.metaStore = 'novel_meta';
        this.contentStore = 'novel_content';
        this.chapterStore = 'novel_chapter';
        this.commentStore = 'novel_comment';
        this.db = null;
    }

    /* ★ 수정: const request 중복 제거 */
    init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 5);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => { this.db = request.result; resolve(this.db); };
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                const tx = event.target.transaction;
                const oldVersion = event.oldVersion;

                if (!db.objectStoreNames.contains(this.metaStore)) {
                    db.createObjectStore(this.metaStore, { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains(this.contentStore)) {
                    db.createObjectStore(this.contentStore, { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains(this.chapterStore)) {
                    const chStore = db.createObjectStore(this.chapterStore, { keyPath: 'key' });
                    chStore.createIndex('byNovel', 'novelId', { unique: false });
                }
                if (!db.objectStoreNames.contains(this.commentStore)) {
                    const cStore = db.createObjectStore(this.commentStore, { keyPath: 'id', autoIncrement: true });
                    cStore.createIndex('byNovel', 'novelId', { unique: false });
                    cStore.createIndex('byChapter', ['novelId', 'chapterIdx'], { unique: false });
                    cStore.createIndex('byParent', ['novelId', 'chapterIdx', 'parentId'], { unique: false });
                }

                // v1 → v2
                if (oldVersion < 2 && db.objectStoreNames.contains('novels')) {
                    const oldStore = tx.objectStore('novels');
                    const metaStore = tx.objectStore(this.metaStore);
                    const contentStore = tx.objectStore(this.contentStore);
                    const req = oldStore.getAll();
                    req.onsuccess = () => {
                        (req.result || []).forEach(n => {
                            const { chapters, settings, ...meta } = n;
                            const chs = chapters || [];
                            const sts = settings || [];
                            meta.chapterCount = chs.length;
                            meta.totalChars = chs.reduce((s, c) => s + ((c.content || '').length), 0);
                            meta.hasRichSettings = computeHasRichSettings(sts);
                            meta.status = meta.status || 'ongoing';
                            meta.isAdult = meta.isAdult === true;
                            metaStore.put(meta);
                            contentStore.put({
                                id: n.id,
                                data: JSON.stringify({ chapters: [], settings: sts })
                            });
                        });
                    };
                }

                // v2 → v3
                if (oldVersion >= 2 && oldVersion < 3) {
                    const contentStore = tx.objectStore(this.contentStore);
                    const req = contentStore.getAll();
                    req.onsuccess = () => {
                        (req.result || []).forEach(rec => {
                            if (typeof rec.data === 'string') return;
                            const chs = rec.chapters || [];
                            const sts = rec.settings || [];
                            contentStore.put({
                                id: rec.id,
                                data: JSON.stringify({ chapters: chs, settings: sts })
                            });
                        });
                    };
                }

                // v3 → v4
                if (oldVersion >= 3 && oldVersion < 4) {
                    const contentStore = tx.objectStore(this.contentStore);
                    const chapterStore = tx.objectStore(this.chapterStore);
                    const req = contentStore.getAll();
                    req.onsuccess = () => {
                        (req.result || []).forEach(rec => {
                            let chapters = [];
                            let settings = [];
                            if (typeof rec.data === 'string') {
                                try {
                                    const parsed = JSON.parse(rec.data);
                                    chapters = Array.isArray(parsed.chapters) ? parsed.chapters : [];
                                    settings = Array.isArray(parsed.settings) ? parsed.settings : [];
                                } catch (e) { return; }
                            } else {
                                chapters = Array.isArray(rec.chapters) ? rec.chapters : [];
                                settings = Array.isArray(rec.settings) ? rec.settings : [];
                            }
                            chapters.forEach((ch, idx) => {
                                chapterStore.put(this._chapterRecord(rec.id, idx, ch));
                            });
                            contentStore.put({
                                id: rec.id,
                                data: JSON.stringify({ chapters: [], settings })
                            });
                        });
                    };
                }
                // v4 → v5: commentStore 생성만 하면 됨 (위에서 처리)
            };
        });
    }

    _tx(storeName, mode) {
        return this.db.transaction(storeName, mode).objectStore(storeName);
    }

    /* ── 메타 ── */
    getAllMetas() {
        return new Promise((resolve, reject) => {
            const req = this._tx(this.metaStore, 'readonly').getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    }

    getMeta(id) {
        return new Promise((resolve, reject) => {
            const req = this._tx(this.metaStore, 'readonly').get(id);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
    }

    getContent(id) {
        return new Promise((resolve, reject) => {
            const req = this._tx(this.contentStore, 'readonly').get(id);
            req.onsuccess = () => resolve(this._parseContentRecord(req.result));
            req.onerror = () => reject(req.error);
        });
    }
    /* 회차 레코드 생성 (7곳 중복 제거) */
    _chapterRecord(novelId, idx, ch, now = new Date().toISOString()) {
        return {
            key: `${novelId}:${idx}`,
            novelId,
            idx,
            title: ch.title || '',
            content: ch.content || '',
            createdAt: ch.createdAt || now,
            updatedAt: ch.updatedAt || ch.createdAt || now,
        };
    }

    /* 덧글 레코드 생성 (3곳 중복 제거) */
    _commentRecord(novelId, c, now = new Date().toISOString()) {
        const rec = {
            novelId,
            chapterIdx: c.chapterIdx ?? 0,
            parentId: c.parentId ?? null,
            content: c.content || '',
            createdAt: c.createdAt || now,
            updatedAt: c.updatedAt || c.createdAt || now,
        };
        if (c.id !== undefined) rec.id = c.id;
        return rec;
    }

    /* meta 여러 개를 한 트랜잭션으로 저장 */
    putMetas(metas) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(this.metaStore, 'readwrite');
            const store = tx.objectStore(this.metaStore);
            metas.forEach(m => store.put(m));
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('putMetas aborted'));
        });
    }
    _parseContentRecord(rec) {
        if (!rec) return { chapters: [], settings: [] };
        if (typeof rec.data === 'string') {
            try {
                const parsed = JSON.parse(rec.data);
                return {
                    chapters: Array.isArray(parsed.chapters) ? parsed.chapters : [],
                    settings: Array.isArray(parsed.settings) ? parsed.settings : [],
                };
            } catch (e) {
                console.warn('[db] content JSON parse 실패:', e);
                return { chapters: [], settings: [] };
            }
        }
        return {
            chapters: Array.isArray(rec.chapters) ? rec.chapters : [],
            settings: Array.isArray(rec.settings) ? rec.settings : [],
        };
    }

    /* ── 회차 ── */
    getChapter(novelId, chapterIdx) {
        return new Promise((resolve, reject) => {
            const req = this._tx(this.chapterStore, 'readonly').get(`${novelId}:${chapterIdx}`);
            req.onsuccess = () => {
                const rec = req.result;
                if (!rec) return resolve(null);
                resolve({
                    title: rec.title || '',
                    content: rec.content || '',
                    createdAt: rec.createdAt,
                    updatedAt: rec.updatedAt,
                });
            };
            req.onerror = () => reject(req.error);
        });
    }

    /* byNovel 인덱스로 회차 레코드를 idx 순서로 조회 (공통) */
    _getChapterRecords(novelId) {
        return new Promise((resolve, reject) => {
            const req = this._tx(this.chapterStore, 'readonly').index('byNovel').getAll(novelId);
            req.onsuccess = () => resolve((req.result || []).sort((a, b) => a.idx - b.idx));
            req.onerror = () => reject(req.error);
        });
    }

    async getAllChapterMetas(novelId) {
        const recs = await this._getChapterRecords(novelId);
        return recs.map(rec => ({
            title: rec.title || '',
            charCount: (rec.content || '').length,
            createdAt: rec.createdAt,
            updatedAt: rec.updatedAt,
        }));
    }

    async getAllChapters(novelId) {
        const recs = await this._getChapterRecords(novelId);
        return recs.map(rec => ({
            title: rec.title || '',
            content: rec.content || '',
            createdAt: rec.createdAt,
            updatedAt: rec.updatedAt,
        }));
    }

    async getSettings(novelId) {
        const content = await this.getContent(novelId);
        return content.settings || [];
    }

    async getNovelShell(id) {
        const [meta, settings, chapterMetas] = await Promise.all([
            this.getMeta(id),
            this.getSettings(id),
            this.getAllChapterMetas(id),
        ]);
        if (!meta) return null;
        return { ...meta, settings, chapterMetas };
    }

    /* ★ 수정: comments 포함 (구조분해 4개) */
    async getNovelById(id) {
        const [meta, content, chapters, comments] = await Promise.all([
            this.getMeta(id),
            this.getContent(id),
            this.getAllChapters(id),
            this.getAllComments(id),
        ]);
        if (!meta) return null;
        return { ...meta, chapters, settings: content.settings, comments };
    }

    _computeMetaFields(meta, chs, sts) {
        meta.chapterCount = chs.length;
        meta.totalChars = chs.reduce((s, c) => s + ((c.content || '').length), 0);
        meta.hasRichSettings = computeHasRichSettings(sts);
        meta.status = meta.status || 'ongoing';
        meta.isAdult = meta.isAdult === true;
        return meta;
    }

    /* ── saveNovel: 댓글은 명시적으로 넘어온 경우에만 재작성 ── */
    saveNovel(novel) {
        return new Promise((resolve, reject) => {
            const { chapters, settings, comments, chapterMetas, ...meta } = novel;
            const sts = Array.isArray(settings) ? settings : [];
            const cms = Array.isArray(comments) ? comments : [];

            const hasRealChapters = Array.isArray(chapters)
                && chapters.length > 0
                && chapters.every(c => c && typeof c === 'object' && ('content' in c || 'title' in c));

            const tx = this.db.transaction(
                [this.metaStore, this.contentStore, this.chapterStore, this.commentStore],
                'readwrite'
            );
            const metaStore    = tx.objectStore(this.metaStore);
            const contentStore = tx.objectStore(this.contentStore);
            const chapterStore = tx.objectStore(this.chapterStore);
            const commentStore = tx.objectStore(this.commentStore);

            const metaReq = metaStore.get(novel.id);
            metaReq.onsuccess = () => {
                const existing = metaReq.result || {};
                const merged = {
                    ...existing,
                    ...meta,
                    chapterCount: existing.chapterCount || 0,
                    totalChars: existing.totalChars || 0,
                    status: meta.status || existing.status || 'ongoing',
                    isAdult: meta.isAdult === true,
                    hasRichSettings: computeHasRichSettings(sts),
                    updatedAt: meta.updatedAt || existing.updatedAt || new Date().toISOString(),
                };
                delete merged.chapterMetas;   // 회차 메타는 meta 레코드에 저장하지 않는다 (옛 레코드의 잔재도 제거)
                if (hasRealChapters) {
                    merged.chapterCount = chapters.length;
                    merged.totalChars = chapters.reduce((s, c) => s + ((c.content || '').length), 0);
                }
                metaStore.put(merged);

                contentStore.put({
                    id: novel.id,
                    data: JSON.stringify({ chapters: [], settings: sts })
                });

                if (hasRealChapters) {
                    const idxReq = chapterStore.index('byNovel').getAllKeys(novel.id);
                    idxReq.onsuccess = () => {
                        (idxReq.result || []).forEach(k => chapterStore.delete(k));
                        chapters.forEach((ch, idx) => chapterStore.put(this._chapterRecord(novel.id, idx, ch)));
                    };
                }

                if (Array.isArray(comments)) {
                    const delReq = commentStore.index('byNovel').getAllKeys(novel.id);
                    delReq.onsuccess = () => {
                        (delReq.result || []).forEach(k => commentStore.delete(k));
                        cms.forEach(c => commentStore.put(this._commentRecord(novel.id, c)));
                    };
                }

                tx._resolvedMeta = merged;
            };

            tx.oncomplete = () => resolve(tx._resolvedMeta || meta);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('saveNovel aborted'));
        });
    }

    saveChapter(novelId, chapterIndex, chapter) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(
                [this.metaStore, this.chapterStore],
                'readwrite'
            );
            const metaStore = tx.objectStore(this.metaStore);
            const chapterStore = tx.objectStore(this.chapterStore);

            const metaReq = metaStore.get(novelId);
            const chReq = chapterStore.get(`${novelId}:${chapterIndex}`);

            let meta = null;
            let oldCh = null;
            let metaDone = false, chDone = false;

            const tryCommit = () => {
                if (!metaDone || !chDone) return;
                if (!meta) {
                    try { tx.abort(); } catch (e) {}
                    return;
                }
                const now = new Date().toISOString();

                chapterStore.put({
                    key: `${novelId}:${chapterIndex}`,
                    novelId,
                    idx: chapterIndex,
                    title: chapter.title || '',
                    content: chapter.content || '',
                    createdAt: oldCh?.createdAt || chapter.createdAt || now,
                    updatedAt: now,
                });

                const oldLen = oldCh ? (oldCh.content || '').length : 0;
                const newLen = (chapter.content || '').length;
                meta.totalChars = Math.max(0, (meta.totalChars || 0) - oldLen + newLen);
                meta.updatedAt = now;
                metaStore.put(meta);
            };

            metaReq.onsuccess = () => { meta = metaReq.result || null; metaDone = true; tryCommit(); };
            chReq.onsuccess  = () => { oldCh = chReq.result || null; chDone = true; tryCommit(); };

            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('saveChapter aborted'));
        });
    }

   

    replaceChapters(novelId, chapters) {
        const chs = Array.isArray(chapters) ? chapters : [];
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(
                [this.metaStore, this.chapterStore],
                'readwrite'
            );
            const metaStore = tx.objectStore(this.metaStore);
            const chapterStore = tx.objectStore(this.chapterStore);

            const now = new Date().toISOString();

            const idxReq = chapterStore.index('byNovel').getAllKeys(novelId);
            idxReq.onsuccess = () => {
                (idxReq.result || []).forEach(k => chapterStore.delete(k));
                chs.forEach((ch, idx) => chapterStore.put(this._chapterRecord(novelId, idx, ch, now)));

                const metaReq = metaStore.get(novelId);
                metaReq.onsuccess = () => {
                    const meta = metaReq.result;
                    if (meta) {
                        meta.chapterCount = chs.length;
                        meta.totalChars = chs.reduce((s, c) => s + ((c.content || '').length), 0);
                        meta.updatedAt = now;
                        metaStore.put(meta);
                    }
                };
            };

            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('replaceChapters aborted'));
        });
    }

    /* ★ 수정: 댓글도 함께 삭제 */
    deleteNovel(id) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(
                [this.metaStore, this.contentStore, this.chapterStore, this.commentStore],
                'readwrite'
            );
            tx.objectStore(this.metaStore).delete(id);
            tx.objectStore(this.contentStore).delete(id);

            const chStore = tx.objectStore(this.chapterStore);
            const idxReq = chStore.index('byNovel').getAllKeys(id);
            idxReq.onsuccess = () => {
                (idxReq.result || []).forEach(k => chStore.delete(k));
            };

            const cStore = tx.objectStore(this.commentStore);
            const cIdxReq = cStore.index('byNovel').getAllKeys(id);
            cIdxReq.onsuccess = () => {
                (cIdxReq.result || []).forEach(k => cStore.delete(k));
            };

            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('deleteNovel aborted'));
        });
    }

    saveAllNovels(novels) {
        return this._putNovelsChunk(novels, { clear: true });
    }

    async refreshRichSettingsFlags() {
        const metas = await this.getAllMetas();
        if (!metas.some(m => m.hasRichSettings === undefined)) return 0;
        const changed = [];
        for (const meta of metas) {
            const content = await this.getContent(meta.id);
            const flag = computeHasRichSettings(content.settings);
            if (meta.hasRichSettings !== flag) {
                meta.hasRichSettings = flag;
                changed.push(meta);
            }
        }
        if (changed.length) await this.putMetas(changed);
        return changed.length;
    }

    /* ============================================================
       ★ 댓글 CRUD (클래스 내부)
       ============================================================ */

    addComment(novelId, chapterIdx, { content, parentId = null }) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(this.commentStore, 'readwrite');
            const store = tx.objectStore(this.commentStore);
            const now = new Date().toISOString();
            const rec = {
                novelId,
                chapterIdx,
                parentId,
                content: content || '',
                createdAt: now,
                updatedAt: now,
            };
            const req = store.add(rec);
            req.onsuccess = () => resolve({ id: req.result, ...rec });
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('addComment aborted'));
        });
    }

    updateComment(id, content) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(this.commentStore, 'readwrite');
            const store = tx.objectStore(this.commentStore);
            const getReq = store.get(id);
            getReq.onsuccess = () => {
                const rec = getReq.result;
                if (!rec) {
                    try { tx.abort(); } catch (e) {}
                    return;
                }
                rec.content = content || '';
                rec.updatedAt = new Date().toISOString();
                store.put(rec);
            };
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('updateComment aborted'));
        });
    }

    /* ★ 수정: byParent 인덱스 사용, async executor 제거 */
    deleteComment(id) {
        return new Promise((resolve, reject) => {
            const roStore = this._tx(this.commentStore, 'readonly');
            const getReq = roStore.get(id);
            getReq.onerror = () => reject(getReq.error);
            getReq.onsuccess = () => {
                const target = getReq.result;
                if (!target) return reject(new Error('댓글 없음'));

                const tx = this.db.transaction(this.commentStore, 'readwrite');
                const store = tx.objectStore(this.commentStore);

                if (target.parentId) {
                    // 답댓글 → 본인만 삭제
                    store.delete(id);
                } else {
                    // 부모 댓글 → byParent 인덱스로 자식 조회 후 함께 삭제
                    const idx = store.index('byParent');
                    const childReq = idx.getAll([target.novelId, target.chapterIdx, id]);
                    childReq.onerror = () => reject(childReq.error);
                    childReq.onsuccess = () => {
                        (childReq.result || []).forEach(c => store.delete(c.id));
                        store.delete(id);
                    };
                }

                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
                tx.onabort = () => reject(tx.error || new Error('deleteComment aborted'));
            };
        });
    }

    /* ★ 수정: createdAt 정렬 */
    getCommentsByChapter(novelId, chapterIdx) {
        return new Promise((resolve, reject) => {
            const store = this._tx(this.commentStore, 'readonly');
            const idx = store.index('byChapter');
            const req = idx.getAll([novelId, chapterIdx]);
            req.onsuccess = () => {
                const list = (req.result || []).sort(
                    (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
                );
                resolve(list);
            };
            req.onerror = () => reject(req.error);
        });
    }

    getAllComments(novelId) {
        return new Promise((resolve, reject) => {
            const store = this._tx(this.commentStore, 'readonly');
            const idx = store.index('byNovel');
            const req = idx.getAll(novelId);
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    }

    /* ★ 수정: openKeyCursor 로 value 역직렬화 비용 절감 */
    getCommentCountsByNovel() {
        return new Promise((resolve, reject) => {
            const store = this._tx(this.commentStore, 'readonly');
            const idx = store.index('byNovel');
            const req = idx.openKeyCursor();
            const counts = {};
            req.onsuccess = () => {
                const cursor = req.result;
                if (cursor) {
                    const novelId = cursor.key;
                    counts[novelId] = (counts[novelId] || 0) + 1;
                    cursor.continue();
                } else resolve(counts);
            };
            req.onerror = () => reject(req.error);
        });
    }

    getCommentCountsByChapter(novelId) {
        return new Promise((resolve, reject) => {
            const store = this._tx(this.commentStore, 'readonly');
            const idx = store.index('byNovel');
            const req = idx.getAll(novelId);
            req.onsuccess = () => {
                const byChapter = {};
                (req.result || []).forEach(r => {
                    byChapter[r.chapterIdx] = (byChapter[r.chapterIdx] || 0) + 1;
                });
                resolve(byChapter);
            };
            req.onerror = () => reject(req.error);
        });
    }
	
    /* 덧글 일괄 보정 (단일 트랜잭션)
       fn(comment) → undefined: 변경 없음 / null: 삭제 / {chapterIdx, novelId?}: 패치 */
    remapComments(novelId, fn) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(this.commentStore, 'readwrite');
            const store = tx.objectStore(this.commentStore);
            const req = store.index('byNovel').getAll(novelId);
            let deleted = 0, changed = 0;
            req.onsuccess = () => {
                for (const c of (req.result || [])) {
                    const patch = fn(c);
                    if (patch === undefined) continue;
                    if (patch === null) { store.delete(c.id); deleted++; continue; }
                    const next = { ...c, ...patch };
                    if (next.chapterIdx === c.chapterIdx && next.novelId === c.novelId) continue;
                    store.put(next);
                    changed++;
                }
            };
            tx.oncomplete = () => resolve({ deleted, changed });
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('remapComments aborted'));
        });
    }

    /* 같은 작품 안에서 인덱스만 바뀔 때 (삭제/순서 이동) */
    remapCommentChapters(novelId, indexMap) {
        return this.remapComments(novelId, (c) => {
            const n = indexMap(c.chapterIdx);
            return n === null ? null : { chapterIdx: n };
        });
    }

    countComments(novelId) {
        return new Promise((resolve, reject) => {
            const req = this._tx(this.commentStore, 'readonly').index('byNovel').count(novelId);
            req.onsuccess = () => resolve(req.result || 0);
            req.onerror = () => reject(req.error);
        });
    }
}

/* ============================================================
   DATABASE - 대용량 복원용 배치 저장
   ============================================================ */

NovelDatabase.prototype._clearAllStores = function () {
    return new Promise((resolve, reject) => {
        const tx = this.db.transaction(
            [this.metaStore, this.contentStore, this.chapterStore, this.commentStore],
            'readwrite'
        );
        tx.objectStore(this.metaStore).clear();
        tx.objectStore(this.contentStore).clear();
        tx.objectStore(this.chapterStore).clear();
        tx.objectStore(this.commentStore).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('clear aborted'));
    });
};

NovelDatabase.prototype._putNovelsChunk = function (chunk, { clear = false } = {}) {
    return new Promise((resolve, reject) => {
        const tx = this.db.transaction(
            [this.metaStore, this.contentStore, this.chapterStore, this.commentStore],
            'readwrite'
        );
        const metaStore = tx.objectStore(this.metaStore);
        const contentStore = tx.objectStore(this.contentStore);
        const chapterStore = tx.objectStore(this.chapterStore);
        const commentStore = tx.objectStore(this.commentStore);

        // 같은 트랜잭션 안에서 비우고 저장 → 원자성 유지
        if (clear) [metaStore, contentStore, chapterStore, commentStore].forEach(s => s.clear());

        for (const n of chunk) {
			const { chapters, settings, comments, chapterMetas, ...meta } = n;
            const chs = Array.isArray(chapters) ? chapters : [];
            const sts = Array.isArray(settings) ? settings : [];
            const cms = Array.isArray(comments) ? comments : [];
            this._computeMetaFields(meta, chs, sts);

            metaStore.put(meta);
            contentStore.put({ id: n.id, data: JSON.stringify({ chapters: [], settings: sts }) });
            chs.forEach((ch, idx) => chapterStore.put(this._chapterRecord(n.id, idx, ch)));
            cms.forEach(c => commentStore.put(this._commentRecord(n.id, c)));
        }

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('put chunk aborted'));
    });
};