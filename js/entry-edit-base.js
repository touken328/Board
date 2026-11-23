/* ============================================================
   ENTRY EDIT BASE: 회차/설정 공통 사이드바·네비게이션·회차 CRUD 로직
   - kind('chapter' | 'setting') 별 상수는 ENTRY_KINDS 표 하나에서 관리한다.
   - 설정(setting)의 추가/수정/삭제/이동은 setting-edit.js 가 override 하므로
     여기의 CRUD 메서드는 회차(chapter) 전용이다. (kind 인자는 시그니처 호환용)
   ============================================================ */

const ENTRY_KINDS = {
    chapter: {
        label: '회차', unit: '화',
        listProp: 'chapterMetas', indexProp: 'selectedChapterIndex', dataAttr: 'data-chapter-btn',
        select: 'selectChapter', move: 'moveChapterTo', add: 'openAddChapterModal',
        prev: 'goToPrevChapter', next: 'goToNextChapter',
        refreshSidebar: 'refreshChapterSidebar', refreshContent: 'refreshChapterContent',
        toast: {
            added: '새 회차가 추가되었습니다.', edited: '회차가 수정되었습니다.',
            deleted: '회차가 삭제되었습니다.', minOne: '최소 1개의 회차는 유지되어야 합니다.',
        },
    },
    setting: {
        label: '설정', unit: '개',
        listProp: 'settings', indexProp: 'selectedSettingIndex', dataAttr: 'data-setting-btn',
        select: 'selectSetting', move: 'moveSettingTo', add: 'openAddSettingModal',
        prev: 'goToPrevSetting', next: 'goToNextSetting',
        refreshSidebar: 'refreshSettingSidebar', refreshContent: 'refreshSettingContent',
        toast: {
            added: '새 설정 노트가 추가되었습니다.', edited: '설정 노트가 수정되었습니다.',
            deleted: '설정 노트가 삭제되었습니다.', minOne: '최소 1개의 설정 노트는 유지되어야 합니다.',
        },
    },
};

const EntryEditMixin = {
    /* ── kind 기반 헬퍼 (setting-edit.js 에서도 사용) ── */
    _entry_getIndex(kind)    { return this[ENTRY_KINDS[kind].indexProp]; },
    _entry_setIndex(kind, i) { this[ENTRY_KINDS[kind].indexProp] = i; },
    _entry_refreshSidebar(kind) { this[ENTRY_KINDS[kind].refreshSidebar](); },
    _entry_refreshContent(kind) { this[ENTRY_KINDS[kind].refreshContent](); },
    _entry_getToastMessages(kind) { return ENTRY_KINDS[kind].toast; },
    _entry_isPrevDisabled(kind) { return this._entry_getIndex(kind) === 0; },
    _entry_isNextDisabled(kind) {
        // ★ chapterMetas/settings 기준 (lazy chapters 배열은 길이가 다를 수 있음)
        const list = this.currentNovel?.[ENTRY_KINDS[kind].listProp] || [];
        return this._entry_getIndex(kind) >= list.length - 1;
    },

    /* 순서 이동 시 새 위치 계산 (len: 대상을 뺀 뒤의 배열 길이) */
    _calcMoveIndex(index, len, action) {
        switch (action) {
            case 'top':    return 0;
            case 'up':     return Math.max(0, index - 1);
            case 'down':   return Math.min(len, index + 1);
            case 'bottom': return len;
            default:       return index;
        }
    },

    /* ── 사이드바: 헤더 + 리스트 ──
       ★ 댓글 배지: chapterMetas[i].commentCount > 0 이면 표시 (첫 진입부터) */
    renderEntrySidebarInner(kind, extraActionsHTML = '') {
        const K = ENTRY_KINDS[kind];
        const list = this.currentNovel?.[K.listProp] || [];
        const activeIdx = this._entry_getIndex(kind);

        return `
            <div class="sidebar-header">
                <h3 class="sidebar-title">${K.label} 목록 (${list.length}${K.unit})</h3>
                <button onclick="app.${K.add}(${this.currentNovel.id})" class="sidebar-add">+ ${K.label} 추가</button>
            </div>
            <div class="sidebar-list">
                ${list.map((item, idx) => {
                    const charCount = item.charCount !== undefined ? item.charCount : (item.content || '').length;
                    const commentCount = kind === 'chapter' ? (item.commentCount || 0) : 0;
                    return `
                    <div class="list-item-row">
                        <button ${K.dataAttr} data-idx="${idx}" onclick="app.${K.select}(${idx})"
                                class="list-item ${idx === activeIdx ? 'active' : ''}">
                            <span class="list-item-title">${escapeHtml(item.title || '')}</span>
                            <span class="list-item-meta">${charCount}자</span>
                            ${commentCount > 0 ? `<span class="comment-badge">💬${commentCount}</span>` : ''}
                        </button>
                    </div>
                `;
                }).join('')}
                ${extraActionsHTML}
            </div>
        `;
    },

    /* ‹ 이전 | 다음 › 버튼 묶음 */
    _renderPrevNextButtons(kind) {
        const K = ENTRY_KINDS[kind];
        return `
            <button onclick="app.${K.prev}()" class="chapter-nav-btn"
                    ${this._entry_isPrevDisabled(kind) ? 'disabled' : ''}
                    title="이전 ${K.label}">‹ 이전 ${K.label}</button>
            <span class="chapter-nav-sep">|</span>
            <button onclick="app.${K.next}()" class="chapter-nav-btn"
                    ${this._entry_isNextDisabled(kind) ? 'disabled' : ''}
                    title="다음 ${K.label}">다음 ${K.label} ›</button>
        `;
    },

    renderEntryHeader(kind, title, subtitleHTML = '') {
        return `
            <h3 class="content-title">${escapeHtml(title)}</h3>
            <div class="content-header">
                ${subtitleHTML}
                <div class="chapter-nav">${this._renderPrevNextButtons(kind)}</div>
            </div>
        `;
    },

    renderEntryBottomNav(kind, extraHTML = '') {
        return `
            <div class="content-bottom">
                <div class="chapter-nav">
                    ${this._renderPrevNextButtons(kind)}
                    <span class="chapter-nav-sep">|</span>
                    <button onclick="window.scrollTo({top:0})" class="chapter-nav-btn">맨 위로</button>
                    <span class="chapter-nav-sep">|</span>
                    ${extraHTML}
                    <button onclick="app.goToList()" class="chapter-nav-btn">목록</button>
                </div>
            </div>
        `;
    },

    /* ── 순서 변경 select ── */
    renderEntryMoveSelect(kind) {
        const K = ENTRY_KINDS[kind];
        return `
            <select class="toolbar-select move-select-inline"
                    onchange="app.${K.move}(${this.currentNovel.id}, ${this._entry_getIndex(kind)}, this.value); this.selectedIndex=0;"
                    title="${K.label} 순서 변경">
                <option value="" disabled selected>↕ ${K.label} 순서 변경</option>
                <option value="top">⤒ 맨 위로</option>
                <option value="up">↑ 위로</option>
                <option value="down">↓ 아래로</option>
                <option value="bottom">⤓ 맨 아래로</option>
            </select>
        `;
    },

    /* ── chapterMetas[idx] 패치 + 사이드바 DOM(해당 회차만) 갱신 ──
       - patch: { title?, charCount?, updatedAt?, createdAt?, commentCount? }
       - currentNovel.chapters[idx] (lazy) 도 title/updatedAt 동기화
       - 사이드바가 DOM 에 있으면 해당 버튼의 .list-item-title/.list-item-meta/.comment-badge 갱신 */
    _updateChapterMeta(idx, patch) {
        const metas = this.currentNovel?.chapterMetas;
        if (!Array.isArray(metas) || !metas[idx]) return;
        const m = metas[idx];

        if (patch.title !== undefined)        m.title = patch.title;
        if (patch.charCount !== undefined)    m.charCount = patch.charCount;
        if (patch.updatedAt !== undefined)    m.updatedAt = patch.updatedAt;
        if (patch.createdAt !== undefined)    m.createdAt = patch.createdAt;
        if (patch.commentCount !== undefined) m.commentCount = patch.commentCount;

        // 로드된 회차 객체도 동기화
        const arr = this.currentNovel.chapters;
        if (Array.isArray(arr) && arr[idx] && typeof arr[idx] === 'object') {
            if (patch.title !== undefined)     arr[idx].title = patch.title;
            if (patch.updatedAt !== undefined) arr[idx].updatedAt = patch.updatedAt;
        }

        // 사이드바 DOM 부분 갱신 (해당 인덱스만)
        const btn = document.querySelector(`[data-chapter-btn][data-idx="${idx}"]`);
        if (!btn) return;
        if (patch.title !== undefined) {
            const titleEl = btn.querySelector('.list-item-title');
            if (titleEl) titleEl.textContent = patch.title || '';
        }
        if (patch.charCount !== undefined) {
            const metaEl = btn.querySelector('.list-item-meta');
            if (metaEl) metaEl.textContent = `${patch.charCount}자`;
        }
        if (patch.commentCount !== undefined) {
            let badge = btn.querySelector('.comment-badge');
            if (patch.commentCount > 0) {
                if (!badge) {
                    badge = document.createElement('span');
                    badge.className = 'comment-badge';
                    btn.appendChild(badge);
                }
                badge.textContent = `💬${patch.commentCount}`;
            } else if (badge) {
                badge.remove();
            }
        }
    },

    /* ── 회차 배열 lazy 상태에서 index 위치의 회차를 "확실히" 확보 ──
       - chapters[idx] 가 실제 객체면 그대로 반환
       - 아니면 DB 에서 로드 후 chapters[idx] 와 chapterMetas[idx] 동기화
       - ★ 반드시 "현재 순서" 기준으로 호출해야 함 (재배열 후 호출 금지) */
    async _ensureChapterAt(idx) {
        if (!this.currentNovel) return null;
        const arr = this.currentNovel.chapters;
        if (Array.isArray(arr) && arr[idx] && typeof arr[idx] === 'object') return arr[idx];
        const loaded = await this.ensureChapterLoaded(this.currentNovel.id, idx);
        if (!loaded) return null;
        if (!Array.isArray(this.currentNovel.chapters)) this.currentNovel.chapters = [];
        this.currentNovel.chapters[idx] = loaded;
        this._updateChapterMeta(idx, {
            title: loaded.title || undefined,
            charCount: (loaded.content || '').length,
            updatedAt: loaded.updatedAt,
            createdAt: loaded.createdAt,
        });
        return loaded;
    },

    /* 현재 순서(재배열 전) 기준으로 전체 회차 본문 확보. skip: 제외할 인덱스 */
    async _snapshotAllChaptersInCurrentOrder({ skip = -1 } = {}) {
        const metas = this.currentNovel?.chapterMetas || [];
        const out = [];
        for (let i = 0; i < metas.length; i++) {
            if (i === skip) continue;
            const ch = await this._ensureChapterAt(i);
            const m = metas[i];
            out.push({
                title: ch?.title || m.title || '',
                content: ch?.content || '',
                createdAt: ch?.createdAt || m.createdAt,
                updatedAt: ch?.updatedAt || m.updatedAt,
            });
        }
        return out;
    },

    /* 메모리의 currentNovel.chapters 를 스냅샷(실제 객체)으로 통째로 교체 */
    _replaceLoadedChapters(snapshot) {
        const arr = this.currentNovel.chapters = Array.isArray(this.currentNovel.chapters)
            ? this.currentNovel.chapters : [];
        arr.length = 0;
        snapshot.forEach((ch, i) => { arr[i] = ch; });
    },

    /* ── 순서 이동 (회차 전용) ──
       ★ 안전 순서: 스냅샷 → chapterMetas/스냅샷 동일 splice → DB 1회 재기록 → 덧글/캐시/목록 보정 */
    async moveEntryTo(kind, novelId, index, action) {
        await this.flushAutoSave();
        if (!this.currentNovel) return;

        const metas = this.currentNovel.chapterMetas;
        if (!Array.isArray(metas) || index < 0 || index >= metas.length) return;

        // 1) 재배열 전에 전체 본문 확보
        const snapshot = await this._snapshotAllChaptersInCurrentOrder();

        // 2) chapterMetas 와 스냅샷을 동일하게 재배열
        const [meta] = metas.splice(index, 1);
        if (!meta) return;
        const newIndex = this._calcMoveIndex(index, metas.length, action);
        metas.splice(newIndex, 0, meta);

        const [snap] = snapshot.splice(index, 1);
        snapshot.splice(newIndex, 0, snap);

        // 3) 메모리 반영
        this._replaceLoadedChapters(snapshot);
        this._entry_setIndex(kind, newIndex);
        this.currentNovel.updatedAt = new Date().toISOString();

        // 4) DB 재기록 (1회) + 캐시/덧글/목록 보정
        await this.db.replaceChapters(novelId, snapshot);
        this._clearChapterCache();
        await this.db.remapCommentChapters(novelId, ChapterIndexMap.move(index, newIndex));
        this._resetCommentUiState();
        await this._syncListMeta(novelId);

        this.showToast(`"${metas[this.selectedChapterIndex]?.title || ''}" 순서 변경`);
        this._entry_refreshSidebar(kind);
        this._entry_refreshContent(kind);
        this.rememberPosition();
    },

    /* ── 삭제 (회차 전용) ──
       ★ 안전 순서: 대상 제외 스냅샷 → 메모리 반영 → DB 1회 재기록 → 덧글/캐시/목록 보정 */
    async deleteEntry(kind, novelId, index) {
        await this.flushAutoSave();
        if (!this.currentNovel) return;
        const msgs = this._entry_getToastMessages(kind);

        const metas = this.currentNovel.chapterMetas;
        if (!Array.isArray(metas)) return;
        if (metas.length <= 1) { this.showToast(msgs.minOne, 'error'); return; }
        const targetMeta = metas[index];
        if (!targetMeta) return;
        if (!confirm(`"${targetMeta.title}" 회차을(를) 삭제하시겠습니까?\n(이 회차의 덧글도 함께 삭제됩니다)`)) return;

        const remaining = await this._snapshotAllChaptersInCurrentOrder({ skip: index });

        metas.splice(index, 1);
        this._replaceLoadedChapters(remaining);
        this.currentNovel.updatedAt = new Date().toISOString();

        await this.db.replaceChapters(novelId, remaining);
        this._clearChapterCache();
        await this.db.remapCommentChapters(novelId, ChapterIndexMap.remove(index));
        this._resetCommentUiState();
        await this._syncListCommentCount(novelId);
        await this._syncListMeta(novelId);

        this._entry_setIndex(kind, Math.max(0, index - 1));
        this.showToast(msgs.deleted);
        this._entry_refreshSidebar(kind);
        this._entry_refreshContent(kind);
    },

    /* ── 추가 (회차 전용) ── */
    async addEntrySubmit(kind, { title, content }) {
        await this.flushAutoSave();
        if (!this.currentNovel) return;
        const nowISO = new Date().toISOString();

        if (!Array.isArray(this.currentNovel.chapterMetas)) this.currentNovel.chapterMetas = [];
        const newIdx = this.currentNovel.chapterMetas.length;
        const newChapter = { title, content, createdAt: nowISO, updatedAt: nowISO };
        this.currentNovel.chapterMetas.push({
            title,
            charCount: (content || '').length,
            commentCount: 0,             // ★ 신규 회차는 댓글 0
            createdAt: nowISO,
            updatedAt: nowISO,
        });
        if (!Array.isArray(this.currentNovel.chapters)) this.currentNovel.chapters = [];
        this.currentNovel.chapters[newIdx] = newChapter;
        this.currentNovel.updatedAt = nowISO;

        await this.db.saveChapter(this.currentNovel.id, newIdx, newChapter);
        await this._bumpMetaCount(this.currentNovel.id, +1);

        this._entry_setIndex(kind, newIdx);
        this.closeModal();
        this.showToast(this._entry_getToastMessages(kind).added);
        this._entry_refreshSidebar(kind);
        this._entry_refreshContent(kind);
    },

    /* ── 수정 (회차 전용) ── */
    async editEntrySubmit(kind, { index, title, content }) {
        await this.flushAutoSave();
        if (!this.currentNovel) return;
        const nowISO = new Date().toISOString();

        const ch = await this._ensureChapterAt(index);
        if (!ch) return;
        ch.title = title;
        ch.content = content;
        ch.updatedAt = nowISO;
        this._updateChapterMeta(index, { title, charCount: (content || '').length, updatedAt: nowISO });
        this.currentNovel.updatedAt = nowISO;
        await this.db.saveChapter(this.currentNovel.id, index, ch);

        this.closeModal();
        this.showToast(this._entry_getToastMessages(kind).edited);
        this._entry_refreshSidebar(kind);
        this._entry_refreshContent(kind);
    },

    /* ── 목록/메타 동기화 ── */
    /* 목록용 덧글 수 재계산 (novels 의 commentCount 는 메모리 전용 필드) */
    async _syncListCommentCount(novelId) {
        const local = this.novels.find(n => n.id === novelId);
        if (local) local.commentCount = await this.db.countComments(novelId);
    },
    _resetCommentUiState() {
        this._commentOpenReplyId = null;
        this._commentEditId = null;
    },
    /* DB 의 최신 meta 를 목록(this.novels)에 병합 — commentCount 같은 메모리 전용 필드는 보존 */
    async _syncListMeta(novelId) {
        const fresh = await this.db.getMeta(novelId);
        const local = this.novels.find(n => n.id === novelId);
        if (fresh && local) Object.assign(local, fresh);
    },

    async _bumpMetaCount(novelId, delta) {
        try {
            const meta = await this.db.getMeta(novelId);
            if (!meta) return;
            meta.chapterCount = Math.max(0, (meta.chapterCount || 0) + delta);
            meta.updatedAt = new Date().toISOString();
            await this.db.putMetas([meta]);
            await this._syncListMeta(novelId);
        } catch (e) {
            console.warn('[meta] chapterCount 갱신 실패:', e);
        }
    },
};