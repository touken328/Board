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
                                chapterStore.put({
                                    key: `${rec.id}:${idx}`,
                                    novelId: rec.id,
                                    idx,
                                    title: ch.title || '',
                                    content: ch.content || '',
                                    createdAt: ch.createdAt || new Date().toISOString(),
                                    updatedAt: ch.updatedAt || ch.createdAt || new Date().toISOString(),
                                });
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

    getAllChapterMetas(novelId) {
        return new Promise((resolve, reject) => {
            const store = this._tx(this.chapterStore, 'readonly');
            const idx = store.index('byNovel');
            const req = idx.getAll(novelId);
            req.onsuccess = () => {
                const list = (req.result || [])
                    .sort((a, b) => a.idx - b.idx)
                    .map(rec => ({
                        title: rec.title || '',
                        charCount: (rec.content || '').length,
                        createdAt: rec.createdAt,
                        updatedAt: rec.updatedAt,
                    }));
                resolve(list);
            };
            req.onerror = () => reject(req.error);
        });
    }

    getAllChapters(novelId) {
        return new Promise((resolve, reject) => {
            const store = this._tx(this.chapterStore, 'readonly');
            const idx = store.index('byNovel');
            const req = idx.getAll(novelId);
            req.onsuccess = () => {
                const list = (req.result || [])
                    .sort((a, b) => a.idx - b.idx)
                    .map(rec => ({
                        title: rec.title || '',
                        content: rec.content || '',
                        createdAt: rec.createdAt,
                        updatedAt: rec.updatedAt,
                    }));
                resolve(list);
            };
            req.onerror = () => reject(req.error);
        });
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
            const { chapters, settings, comments, ...meta } = novel;
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
                        chapters.forEach((ch, idx) => {
                            chapterStore.put({
                                key: `${novel.id}:${idx}`,
                                novelId: novel.id,
                                idx,
                                title: ch.title || '',
                                content: ch.content || '',
                                createdAt: ch.createdAt || new Date().toISOString(),
                                updatedAt: ch.updatedAt || ch.createdAt || new Date().toISOString(),
                            });
                        });
                    };
                }

                // ★ comments 가 명시된 경우에만 재작성 (undefined → 보존)
                if (Array.isArray(comments)) {
                    const delReq = commentStore.index('byNovel').getAllKeys(novel.id);
                    delReq.onsuccess = () => {
                        (delReq.result || []).forEach(k => commentStore.delete(k));
                        cms.forEach(c => {
                            const rec = {
                                novelId: novel.id,
                                chapterIdx: c.chapterIdx ?? 0,
                                parentId: c.parentId ?? null,
                                content: c.content || '',
                                createdAt: c.createdAt || new Date().toISOString(),
                                updatedAt: c.updatedAt || c.createdAt || new Date().toISOString(),
                            };
                            if (c.id !== undefined) rec.id = c.id;
                            commentStore.put(rec);
                        });
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

    deleteChapter(novelId, chapterIndex) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(
                [this.metaStore, this.chapterStore],
                'readwrite'
            );
            const metaStore = tx.objectStore(this.metaStore);
            const chapterStore = tx.objectStore(this.chapterStore);

            const chReq = chapterStore.get(`${novelId}:${chapterIndex}`);
            const metaReq = metaStore.get(novelId);
            let oldCh = null, meta = null;
            let chDone = false, metaDone = false;

            const tryCommit = () => {
                if (!chDone || !metaDone) return;
                if (oldCh) {
                    chapterStore.delete(`${novelId}:${chapterIndex}`);
                }
                if (meta) {
                    meta.chapterCount = Math.max(0, (meta.chapterCount || 0) - 1);
                    meta.totalChars = Math.max(0, (meta.totalChars || 0) - ((oldCh?.content || '').length));
                    meta.updatedAt = new Date().toISOString();
                    metaStore.put(meta);
                }
            };

            chReq.onsuccess = () => { oldCh = chReq.result || null; chDone = true; tryCommit(); };
            metaReq.onsuccess = () => { meta = metaReq.result || null; metaDone = true; tryCommit(); };

            tx.oncomplete = () => resolve(!!oldCh);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('deleteChapter aborted'));
        });
    }

    insertChapter(novelId, insertIndex, chapter) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(
                [this.metaStore, this.chapterStore],
                'readwrite'
            );
            const metaStore = tx.objectStore(this.metaStore);
            const chapterStore = tx.objectStore(this.chapterStore);

            const getAllReq = chapterStore.index('byNovel').getAll(novelId);

            getAllReq.onsuccess = () => {
                const all = (getAllReq.result || []).sort((a, b) => a.idx - b.idx);
                const now = new Date().toISOString();

                const newRec = {
                    key: `${novelId}:${insertIndex}`,
                    novelId,
                    idx: insertIndex,
                    title: chapter.title || '',
                    content: chapter.content || '',
                    createdAt: chapter.createdAt || now,
                    updatedAt: now,
                };

                const tail = all.filter(r => r.idx >= insertIndex);
                for (let i = tail.length - 1; i >= 0; i--) {
                    const r = tail[i];
                    const newIdx = r.idx + 1;
                    chapterStore.delete(r.key);
                    chapterStore.put({
                        key: `${novelId}:${newIdx}`,
                        novelId,
                        idx: newIdx,
                        title: r.title,
                        content: r.content,
                        createdAt: r.createdAt,
                        updatedAt: r.updatedAt,
                    });
                }
                chapterStore.put(newRec);

                const metaReq = metaStore.get(novelId);
                metaReq.onsuccess = () => {
                    const meta = metaReq.result;
                    if (meta) {
                        meta.chapterCount = (meta.chapterCount || 0) + 1;
                        meta.totalChars = (meta.totalChars || 0) + ((chapter.content || '').length);
                        meta.updatedAt = now;
                        metaStore.put(meta);
                    }
                };
            };

            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('insertChapter aborted'));
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
                chs.forEach((ch, idx) => {
                    chapterStore.put({
                        key: `${novelId}:${idx}`,
                        novelId,
                        idx,
                        title: ch.title || '',
                        content: ch.content || '',
                        createdAt: ch.createdAt || now,
                        updatedAt: ch.updatedAt || ch.createdAt || now,
                    });
                });

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
        const tx = this.db.transaction(
            [this.metaStore, this.contentStore, this.chapterStore, this.commentStore],
            'readwrite'
        );
        const metaStore = tx.objectStore(this.metaStore);
        const contentStore = tx.objectStore(this.contentStore);
        const chapterStore = tx.objectStore(this.chapterStore);
        const commentStore = tx.objectStore(this.commentStore);
        metaStore.clear();
        contentStore.clear();
        chapterStore.clear();
        commentStore.clear();

        for (const n of novels) {
            const { chapters, settings, comments, ...meta } = n;
            const chs = Array.isArray(chapters) ? chapters : [];
            const sts = Array.isArray(settings) ? settings : [];
            const cms = Array.isArray(comments) ? comments : [];
            this._computeMetaFields(meta, chs, sts);
            metaStore.put(meta);
            contentStore.put({
                id: n.id,
                data: JSON.stringify({ chapters: [], settings: sts })
            });
            chs.forEach((ch, idx) => {
                chapterStore.put({
                    key: `${n.id}:${idx}`,
                    novelId: n.id,
                    idx,
                    title: ch.title || '',
                    content: ch.content || '',
                    createdAt: ch.createdAt || new Date().toISOString(),
                    updatedAt: ch.updatedAt || ch.createdAt || new Date().toISOString(),
                });
            });
            for (const c of cms) {
                const rec = {
                    novelId: n.id,
                    chapterIdx: c.chapterIdx ?? 0,
                    parentId: c.parentId ?? null,
                    content: c.content || '',
                    createdAt: c.createdAt || new Date().toISOString(),
                    updatedAt: c.updatedAt || c.createdAt || new Date().toISOString(),
                };
                if (c.id !== undefined) rec.id = c.id;
                commentStore.put(rec);
            }
        }
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('saveAllNovels aborted'));
        });
    }

    async refreshRichSettingsFlags() {
        const metas = await this.getAllMetas();
        if (!metas.some(m => m.hasRichSettings === undefined)) return 0;
        let updated = 0;
        for (const meta of metas) {
            const content = await this.getContent(meta.id);
            const hasRichSettings = computeHasRichSettings(content.settings);
            if (meta.hasRichSettings !== hasRichSettings) {
                meta.hasRichSettings = hasRichSettings;
                await new Promise((resolve, reject) => {
                    const tx = this.db.transaction(this.metaStore, 'readwrite');
                    tx.objectStore(this.metaStore).put(meta);
                    tx.oncomplete = resolve;
                    tx.onerror = () => reject(tx.error);
                });
                updated++;
            }
        }
        return updated;
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
}

/* ============================================================
   DATABASE - 대용량 복원용 배치 저장
   ============================================================ */
NovelDatabase.prototype.saveAllNovelsBatched = async function (novels, options = {}) {
    const {
        batchSize = 30,
        onProgress = null,
        signal = null,
    } = options;

    const total = novels.length;
    const yieldToEventLoop = () => new Promise(r => setTimeout(r, 0));

    await this._clearAllStores();
    if (onProgress) onProgress({ done: 0, total, phase: 'clear' });
    await yieldToEventLoop();

    for (let start = 0; start < total; start += batchSize) {
        if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const chunk = novels.slice(start, start + batchSize);
        await this._putNovelsChunk(chunk);
        const done = Math.min(start + batchSize, total);
        if (onProgress) onProgress({ done, total, phase: 'save' });
        await yieldToEventLoop();
    }

    if (onProgress) onProgress({ done: total, total, phase: 'done' });
};

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

NovelDatabase.prototype._putNovelsChunk = function (chunk) {
    return new Promise((resolve, reject) => {
        const tx = this.db.transaction(
            [this.metaStore, this.contentStore, this.chapterStore, this.commentStore],
            'readwrite'
        );
        const metaStore = tx.objectStore(this.metaStore);
        const contentStore = tx.objectStore(this.contentStore);
        const chapterStore = tx.objectStore(this.chapterStore);
        const commentStore = tx.objectStore(this.commentStore);

        for (const n of chunk) {
            const { chapters, settings, comments, ...meta } = n;
            const chs = Array.isArray(chapters) ? chapters : [];
            const sts = Array.isArray(settings) ? settings : [];
            const cms = Array.isArray(comments) ? comments : [];
            this._computeMetaFields(meta, chs, sts);

            metaStore.put(meta);
            contentStore.put({
                id: n.id,
                data: JSON.stringify({ chapters: [], settings: sts })
            });
            chs.forEach((ch, idx) => {
                chapterStore.put({
                    key: `${n.id}:${idx}`,
                    novelId: n.id,
                    idx,
                    title: ch.title || '',
                    content: ch.content || '',
                    createdAt: ch.createdAt || new Date().toISOString(),
                    updatedAt: ch.updatedAt || ch.createdAt || new Date().toISOString(),
                });
            });

            for (const c of cms) {
                const rec = {
                    novelId: n.id,
                    chapterIdx: c.chapterIdx ?? 0,
                    parentId: c.parentId ?? null,
                    content: c.content || '',
                    createdAt: c.createdAt || new Date().toISOString(),
                    updatedAt: c.updatedAt || c.createdAt || new Date().toISOString(),
                };
                if (c.id !== undefined) rec.id = c.id;
                commentStore.put(rec);
            }
        }

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('put chunk aborted'));
    });
};