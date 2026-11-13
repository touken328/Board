/* ============================================================
   ENTRY EDIT BASE: 회차/설정 공통 CRUD/네비게이션/사이드바 로직
   - 각 공통 메서드는 kind('chapter' | 'setting') 인자를 받는다.
   - 각 mixin은 kind를 넘기는 wrapper만 제공한다.
   ============================================================ */

const EntryEditMixin = {
    /* ── kind 기반 헬퍼 ── */
    _entry_getList(kind) {
        return (kind === 'chapter'
            ? this.currentNovel?.chapters
            : this.currentNovel?.settings) || [];
    },
    _entry_getIndex(kind) {
        return kind === 'chapter' ? this.selectedChapterIndex : this.selectedSettingIndex;
    },
    _entry_setIndex(kind, i) {
        if (kind === 'chapter') this.selectedChapterIndex = i;
        else this.selectedSettingIndex = i;
    },
    _entry_getDataAttr(kind) {
        return kind === 'chapter' ? 'data-chapter-btn' : 'data-setting-btn';
    },
    _entry_getSingularLabel(kind) {
        return kind === 'chapter' ? '회차' : '설정';
    },
    _entry_getSelectMethod(kind) {
        return kind === 'chapter' ? 'selectChapter' : 'selectSetting';
    },
    _entry_getMoveMethod(kind) {
        return kind === 'chapter' ? 'moveChapterTo' : 'moveSettingTo';
    },
    _entry_getOpenAddMethod(kind) {
        return kind === 'chapter' ? 'openAddChapterModal' : 'openAddSettingModal';
    },
    _entry_refreshSidebar(kind) {
        if (kind === 'chapter') this.refreshChapterSidebar();
        else this.refreshSettingSidebar();
    },
    _entry_refreshContent(kind) {
        if (kind === 'chapter') this.refreshChapterContent();
        else this.refreshSettingContent();
    },
    _entry_getPrevMethod(kind) {
        return kind === 'chapter' ? 'goToPrevChapter' : 'goToPrevSetting';
    },
    _entry_getNextMethod(kind) {
        return kind === 'chapter' ? 'goToNextChapter' : 'goToNextSetting';
    },
    _entry_isPrevDisabled(kind) {
        return this._entry_getIndex(kind) === 0;
    },
    _entry_isNextDisabled(kind) {
        // ★ chapterMetas/settings 기준 (lazy chapters 배열은 길이가 다를 수 있음)
        const list = kind === 'chapter'
            ? (this.currentNovel?.chapterMetas || [])
            : (this.currentNovel?.settings || []);
        return this._entry_getIndex(kind) >= list.length - 1;
    },
    _entry_getToastMessages(kind) {
        return kind === 'chapter'
            ? { added: '새 회차가 추가되었습니다.', edited: '회차가 수정되었습니다.', deleted: '회차가 삭제되었습니다.', minOne: '최소 1개의 회차는 유지되어야 합니다.' }
            : { added: '새 설정 노트가 추가되었습니다.', edited: '설정 노트가 수정되었습니다.', deleted: '설정 노트가 삭제되었습니다.', minOne: '최소 1개의 설정 노트는 유지되어야 합니다.' };
    },

    /* ── 사이드바: 헤더 + 리스트 ──
       ★ 댓글 배지: chapterMetas[i].commentCount > 0 이면 표시 (첫 진입부터) */
    renderEntrySidebarInner(kind, extraActionsHTML = '') {
        const list = kind === 'chapter'
            ? (this.currentNovel?.chapterMetas || [])
            : (this.currentNovel?.settings || []);
        const activeIdx = this._entry_getIndex(kind);
        const dataAttr = this._entry_getDataAttr(kind);
        const label = this._entry_getSingularLabel(kind);
        const countLabel = kind === 'chapter' ? `${list.length}화` : `${list.length}개`;

        return `
            <div class="sidebar-header">
                <h3 class="sidebar-title">${label} 목록 (${countLabel})</h3>
                <button onclick="app.${this._entry_getOpenAddMethod(kind)}(${this.currentNovel.id})" class="sidebar-add">+ ${label} 추가</button>
            </div>
            <div class="sidebar-list">
                ${list.map((item, idx) => {
                    const charCount = kind === 'chapter'
                        ? (item.charCount !== undefined ? item.charCount : (item.content || '').length)
                        : (item.content || '').length;
                    const commentCount = kind === 'chapter' ? (item.commentCount || 0) : 0;
                    return `
                    <div class="list-item-row">
                        <button ${dataAttr} data-idx="${idx}" onclick="app.${this._entry_getSelectMethod(kind)}(${idx})"
                                class="list-item ${idx === activeIdx ? 'active' : ''}">
                            <span class="list-item-title">${escapeHtml(item.title || '')}</span>
                            <span class="list-item-meta">${charCount}자</span>
                            ${commentCount > 0
                                ? `<span class="comment-badge">💬${commentCount}</span>`
                                : ''}
                        </button>
                    </div>
                `;
                }).join('')}
                ${extraActionsHTML}
            </div>
        `;
    },

    /* ── 본문 상단: 타이틀 + 이전/다음 ── */
    renderEntryHeader(kind, title, subtitleHTML = '') {
        const label = this._entry_getSingularLabel(kind);
        return `
            <h3 class="content-title">${escapeHtml(title)}</h3>
            <div class="content-header">
                ${subtitleHTML}
                <div class="chapter-nav">
                    <button onclick="app.${this._entry_getPrevMethod(kind)}()" class="chapter-nav-btn"
                            ${this._entry_isPrevDisabled(kind) ? 'disabled' : ''}
                            title="이전 ${label}">‹ 이전 ${label}</button>
                    <span class="chapter-nav-sep">|</span>
                    <button onclick="app.${this._entry_getNextMethod(kind)}()" class="chapter-nav-btn"
                            ${this._entry_isNextDisabled(kind) ? 'disabled' : ''}
                            title="다음 ${label}">다음 ${label} ›</button>
                </div>
            </div>
        `;
    },

    /* ── 순서 변경 select ── */
    renderEntryMoveSelect(kind) {
        const label = this._entry_getSingularLabel(kind);
        return `
            <select class="toolbar-select move-select-inline"
                    onchange="app.${this._entry_getMoveMethod(kind)}(${this.currentNovel.id}, ${this._entry_getIndex(kind)}, this.value); this.selectedIndex=0;"
                    title="${label} 순서 변경">
                <option value="" disabled selected>↕ ${label} 순서 변경</option>
                <option value="top">⤒ 맨 위로</option>
                <option value="up">↑ 위로</option>
                <option value="down">↓ 아래로</option>
                <option value="bottom">⤓ 맨 아래로</option>
            </select>
        `;
    },

    /* ── 하단 네비게이션 ── */
    renderEntryBottomNav(kind, extraHTML = '') {
        const label = this._entry_getSingularLabel(kind);
        return `
            <div class="content-bottom">
                <div class="chapter-nav">
                    <button onclick="app.${this._entry_getPrevMethod(kind)}()" class="chapter-nav-btn"
                            ${this._entry_isPrevDisabled(kind) ? 'disabled' : ''}
                            title="이전 ${label}">‹ 이전 ${label}</button>
                    <span class="chapter-nav-sep">|</span>
                    <button onclick="app.${this._entry_getNextMethod(kind)}()" class="chapter-nav-btn"
                            ${this._entry_isNextDisabled(kind) ? 'disabled' : ''}
                            title="다음 ${label}">다음 ${label} ›</button>
                    <span class="chapter-nav-sep">|</span>
                    <button onclick="window.scrollTo({top:0})" class="chapter-nav-btn">맨 위로</button>
                    <span class="chapter-nav-sep">|</span>
                    ${extraHTML}
                    <button onclick="app.goToList()" class="chapter-nav-btn">목록</button>
                </div>
            </div>
        `;
    },

    /* ── chapterMetas[idx] 패치 + 사이드바 DOM(해당 회차만) 갱신 ──
       - patch: { title?, charCount?, updatedAt?, commentCount? }
       - currentNovel.chapters[idx] (lazy) 도 title/content 있으면 동기화
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
        if (btn) {
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

    /* ── ★ 내부 헬퍼: 현재 순서(재배열 전) 기준으로 전체 회차 본문 확보 ──
       - 반환: [{ title, content, createdAt, updatedAt }, ...]
       - ★ 재배열 이전에 호출해야 안전 (DB 는 옛 순서 기준) */
    async _snapshotAllChaptersInCurrentOrder() {
        const metas = this.currentNovel?.chapterMetas || [];
        const out = [];
        for (let i = 0; i < metas.length; i++) {
            const ch = await this._ensureChapterAt(i);
            if (ch) {
                out.push({
                    title: ch.title || metas[i].title || '',
                    content: ch.content || '',
                    createdAt: ch.createdAt || metas[i].createdAt,
                    updatedAt: ch.updatedAt || metas[i].updatedAt,
                });
            } else {
                out.push({
                    title: metas[i].title || '',
                    content: '',
                    createdAt: metas[i].createdAt,
                    updatedAt: metas[i].updatedAt,
                });
            }
        }
        return out;
    },

    /* ── ★ 호환용: chapterMetas 순서대로 회차 본문 로드 ──
       - ⚠️ metas 를 재배열한 뒤 호출하면 안 됨 (DB 는 옛 순서 기준이므로)
       - 재배열 전 스냅샷이 필요하면 _snapshotAllChaptersInCurrentOrder 사용 */
    async _loadAllChaptersInOrder(metas) {
        const out = [];
        for (let i = 0; i < metas.length; i++) {
            const loaded = await this._ensureChapterAt(i);
            if (loaded) {
                out.push({
                    title: loaded.title,
                    content: loaded.content,
                    createdAt: loaded.createdAt,
                    updatedAt: loaded.updatedAt,
                });
            } else {
                out.push({
                    title: metas[i].title || '',
                    content: '',
                    createdAt: metas[i].createdAt,
                    updatedAt: metas[i].updatedAt,
                });
            }
        }
        return out;
    },

    /* ── 순서 이동 ──
       ★ 안전 순서:
         1) 현재 순서 기준으로 전체 본문 스냅샷 (lazy → 확보)
         2) chapterMetas + 스냅샷 배열을 "동일한 방식"으로 splice
         3) DB replaceChapters 로 1회 재기록 (본문 보존)
         4) DB 에서 meta 최신화
    */
    async moveEntryTo(kind, novelId, index, action) {
        await this.flushAutoSave();
        if (!this.currentNovel) return;

        if (kind === 'chapter') {
            const metas = this.currentNovel.chapterMetas;
            if (!Array.isArray(metas) || index < 0 || index >= metas.length) return;

            // ★ 1) 재배열 전에 전체 본문 확보
            const snapshot = await this._snapshotAllChaptersInCurrentOrder();

            // ★ 2) chapterMetas 재배열
            const [meta] = metas.splice(index, 1);
            if (!meta) return;
            let newIndex = index;
            if (action === 'top') newIndex = 0;
            else if (action === 'up') newIndex = Math.max(0, index - 1);
            else if (action === 'down') newIndex = Math.min(metas.length, index + 1);
            else if (action === 'bottom') newIndex = metas.length;
            metas.splice(newIndex, 0, meta);

            // ★ 3) 스냅샷도 동일하게 재배열
            const [snap] = snapshot.splice(index, 1);
            snapshot.splice(newIndex, 0, snap);

            // ★ 4) 메모리 chapters 배열 재작성 (스냅샷이 전부 실제 객체 → 그대로 유지)
            if (!Array.isArray(this.currentNovel.chapters)) this.currentNovel.chapters = [];
            this.currentNovel.chapters.length = 0;
            for (let i = 0; i < snapshot.length; i++) this.currentNovel.chapters[i] = snapshot[i];

            this._entry_setIndex(kind, newIndex);
            this.currentNovel.updatedAt = new Date().toISOString();

            // ★ 5) DB 재기록 (1회) — 스냅샷을 그대로 사용
            await this.db.replaceChapters(novelId, snapshot);

            // ★ 6) DB meta 최신화
            const freshMeta = await this.db.getMeta(novelId);
            const localMeta = this.novels.find(n => n.id === novelId);
            if (localMeta && freshMeta) {
                localMeta.totalChars = freshMeta.totalChars || 0;
                localMeta.updatedAt = freshMeta.updatedAt || new Date().toISOString();
            }
        } else {
            const arr = this.currentNovel.settings || [];
            if (index < 0 || index >= arr.length) return;
            const [item] = arr.splice(index, 1);
            if (!item) return;
            let newIndex = index;
            if (action === 'top') newIndex = 0;
            else if (action === 'up') newIndex = Math.max(0, index - 1);
            else if (action === 'down') newIndex = Math.min(arr.length, index + 1);
            else if (action === 'bottom') newIndex = arr.length;
            arr.splice(newIndex, 0, item);
            this._entry_setIndex(kind, newIndex);
            this.currentNovel.updatedAt = new Date().toISOString();
            await this.persistCurrentNovel();
        }

        this.showToast(`"${(kind === 'chapter' ? this.currentNovel.chapterMetas[this.selectedChapterIndex]?.title : this.currentNovel.settings[this.selectedSettingIndex]?.title) || ''}" 순서 변경`);
        this._entry_refreshSidebar(kind);
        this._entry_refreshContent(kind);
        this.rememberPosition();
    },

    /* ── 삭제 ──
       ★ 안전 순서:
         1) 삭제 대상을 제외한 모든 회차 본문을 "현재 순서" 기준으로 확보
         2) chapterMetas + 스냅샷 배열에서 삭제 대상 제거
         3) DB replaceChapters 로 1회 재기록
         4) DB meta 최신화
    */
    async deleteEntry(kind, novelId, index) {
        await this.flushAutoSave();
        if (!this.currentNovel) return;
        const msgs = this._entry_getToastMessages(kind);

        if (kind === 'chapter') {
            const metas = this.currentNovel.chapterMetas;
            if (!Array.isArray(metas)) return;
            if (metas.length <= 1) { this.showToast(msgs.minOne, 'error'); return; }
            const targetMeta = metas[index];
            if (!targetMeta) return;
            if (!confirm(`"${targetMeta.title}" 회차을(를) 삭제하시겠습니까?`)) return;

            // ★ 1) 삭제 대상 제외하고 현재 순서 기준으로 본문 확보
            const remaining = [];
            for (let i = 0; i < metas.length; i++) {
                if (i === index) continue;
                const ch = await this._ensureChapterAt(i);
                remaining.push(ch ? {
                    title: ch.title || metas[i].title || '',
                    content: ch.content || '',
                    createdAt: ch.createdAt || metas[i].createdAt,
                    updatedAt: ch.updatedAt || metas[i].updatedAt,
                } : {
                    title: metas[i].title || '',
                    content: '',
                    createdAt: metas[i].createdAt,
                    updatedAt: metas[i].updatedAt,
                });
            }

            // ★ 2) 메모리 재배열
            metas.splice(index, 1);
            if (!Array.isArray(this.currentNovel.chapters)) this.currentNovel.chapters = [];
            this.currentNovel.chapters.length = 0;
            for (let i = 0; i < remaining.length; i++) this.currentNovel.chapters[i] = remaining[i];

            this.currentNovel.updatedAt = new Date().toISOString();

            // ★ 3) DB 재기록 (1회)
            await this.db.replaceChapters(novelId, remaining);

            // ★ 4) DB meta 최신화
            const freshMeta = await this.db.getMeta(novelId);
            const localMeta = this.novels.find(n => n.id === novelId);
            if (localMeta && freshMeta) {
                localMeta.totalChars = freshMeta.totalChars || 0;
                localMeta.updatedAt = freshMeta.updatedAt || new Date().toISOString();
            }
        } else {
            const arr = this.currentNovel.settings;
            if (!Array.isArray(arr)) return;
            if (arr.length <= 1) { this.showToast(msgs.minOne, 'error'); return; }
            const target = arr[index];
            if (!target) return;
            if (!confirm(`"${target.title}" 설정을(를) 삭제하시겠습니까?`)) return;
            arr.splice(index, 1);
            this.currentNovel.updatedAt = new Date().toISOString();
            await this.persistCurrentNovel();
        }

        this._entry_setIndex(kind, Math.max(0, index - 1));
        this.showToast(msgs.deleted);
        this._entry_refreshSidebar(kind);
        this._entry_refreshContent(kind);
    },

    /* ── 추가 ── */
    async addEntrySubmit(kind, { title, content }) {
        await this.flushAutoSave();
        if (!this.currentNovel) return;
        const nowISO = new Date().toISOString();

        if (kind === 'chapter') {
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
        } else {
            this.currentNovel.settings.push({ title, content, createdAt: nowISO, updatedAt: nowISO });
            this.currentNovel.updatedAt = nowISO;
            await this.persistCurrentNovel();
            this._entry_setIndex(kind, this.currentNovel.settings.length - 1);
        }

        this.closeModal();
        this.showToast(this._entry_getToastMessages(kind).added);
        this._entry_refreshSidebar(kind);
        this._entry_refreshContent(kind);
    },

    /* ── meta.chapterCount 를 delta 만큼 조정 (saveChapter 는 totalChars 만 갱신) ── */
    async _bumpMetaCount(novelId, delta) {
        try {
            const meta = await this.db.getMeta(novelId);
            if (!meta) return;
            meta.chapterCount = Math.max(0, (meta.chapterCount || 0) + delta);
            meta.updatedAt = new Date().toISOString();
            await new Promise((resolve, reject) => {
                const tx = this.db.db.transaction(this.db.metaStore, 'readwrite');
                tx.objectStore(this.db.metaStore).put(meta);
                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error);
            });
            const localMeta = this.novels.find(n => n.id === novelId);
            if (localMeta) {
                localMeta.chapterCount = meta.chapterCount;
                localMeta.totalChars = meta.totalChars;
                localMeta.updatedAt = meta.updatedAt;
            }
        } catch (e) {
            console.warn('[meta] chapterCount 갱신 실패:', e);
        }
    },

    /* ── 수정 ── */
    async editEntrySubmit(kind, { index, title, content }) {
        await this.flushAutoSave();
        if (!this.currentNovel) return;
        const nowISO = new Date().toISOString();

        if (kind === 'chapter') {
            const ch = await this._ensureChapterAt(index);
            if (!ch) return;
            ch.title = title;
            ch.content = content;
            ch.updatedAt = nowISO;
            this._updateChapterMeta(index, {
                title,
                charCount: (content || '').length,
                updatedAt: nowISO,
            });
            this.currentNovel.updatedAt = nowISO;
            await this.db.saveChapter(this.currentNovel.id, index, ch);
        } else {
            const arr = this.currentNovel.settings;
            if (!arr || !arr[index]) return;
            Object.assign(arr[index], { title, content, updatedAt: nowISO });
            this.currentNovel.updatedAt = nowISO;
            await this.persistCurrentNovel();
        }

        this.closeModal();
        this.showToast(this._entry_getToastMessages(kind).edited);
        this._entry_refreshSidebar(kind);
        this._entry_refreshContent(kind);
    },
};