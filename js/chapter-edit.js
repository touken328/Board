/* ============================================================
   CHAPTER EDIT: 회차 렌더/추가/수정/삭제, 자동저장, 변환, 검색
   ============================================================ */
const ChapterEditMixin = Object.assign({}, EntryEditMixin, {
    /* ── 사이드바 ── */
    renderChapterSidebarInner() {
        return this.renderEntrySidebarInner('chapter', this._chapterSidebarExtraActions());
    },
    _chapterSidebarExtraActions() {
        return `
            <div class="sidebar-header-actions">
                <button onclick="app.renumberChapters()" class="sidebar-renumber" title="회차 번호를 1화부터 순서대로 재정렬">🔄 재정렬</button>
                <button onclick="app.openMoveChapterModal()" class="sidebar-renumber" title="현재 회차를 다른 작품으로 이동">📤 회차 이동</button>
            </div>
        `;
    },
    _chapterBottomNavExtraActions() {
        const id = this.currentNovel?.id;
        const idx = this.selectedChapterIndex;
        return `
            <button onclick="app.switchDetailTab('settings')" class="chapter-nav-btn">설정 및 메모</button>
            <span class="chapter-nav-sep">|</span>
            <button onclick="app.openAddChapterModal(${id})" class="chapter-nav-btn" title="새 회차 작성">+ 회차 추가</button>
            <span class="chapter-nav-sep">|</span>
			<button onclick="app.copyCurrentChapterContent()" class="chapter-nav-btn" title="본문 복사">📋</button>
			<span class="chapter-nav-sep">|</span>
            <button onclick="app.openEditChapterModal(${id},${idx})" class="chapter-nav-btn" title="현재 회차 수정">✏️</button>
            <span class="chapter-nav-sep">|</span>
            <button onclick="app.deleteCurrentChapter(${id},${idx})" class="chapter-nav-btn" title="현재 회차 삭제">🗑️</button>
            <span class="chapter-nav-sep">|</span>
        `;
    },

    /* ── 회차 번호 계산 ──
       ★ chapterMetas 우선 (lazy chapters 배열은 빈칸이 있을 수 있음) */
    getNextChapterNumber() {
        const metas = this.currentNovel?.chapterMetas;
        const chapters = this.currentNovel?.chapters;
        const list = (Array.isArray(metas) && metas.length > 0)
            ? metas
            : (Array.isArray(chapters) ? chapters : []);
        if (list.length === 0) return 1;
        let maxNum = 0;
        for (const ch of list) {
            const title = (ch && ch.title) || '';
            let m = title.match(/(\d+)\s*화/);
            if (!m) m = title.match(/^\s*(\d+)/);
            if (m) {
                const n = parseInt(m[1], 10);
                if (!Number.isNaN(n) && n > maxNum) maxNum = n;
            }
        }
        return maxNum > 0 ? maxNum + 1 : list.length + 1;
    },

    async renumberChapters() {
        await this.flushAutoSave();
        if (!this.currentNovel) return;
        const chapterMetas = this.currentNovel.chapterMetas;
        if (!Array.isArray(chapterMetas) || chapterMetas.length === 0) return;
        if (!confirm(`모든 회차 제목을 1화부터 ${chapterMetas.length}화까지 순서대로 재정렬합니다.\n계속할까요?`)) return;

        const nowISO = new Date().toISOString();

        for (let i = 0; i < chapterMetas.length; i++) {
            const n = i + 1;
            const meta = chapterMetas[i];
            const title = meta.title || '';
            let newTitle;
            if (/\d+\s*화/.test(title))      newTitle = title.replace(/\d+\s*화/, `${n}화`);
            else if (/^\s*\d+/.test(title))  newTitle = title.replace(/^\s*\d+/, String(n));
            else                              newTitle = `${n}화. ${title}`.trim();

            meta.title = newTitle;
            meta.updatedAt = nowISO;

            // ★ 로드된 회차(캐시/배열) 제목 동기화
            const cached = this._getCachedChapter(this.currentNovel.id, i);
            if (cached) cached.title = newTitle;
            if (Array.isArray(this.currentNovel.chapters) && this.currentNovel.chapters[i]) {
                this.currentNovel.chapters[i].title = newTitle;
            }

            // DB에는 제목/updatedAt만 반영 — 본문은 보존
            const dbCh = await this.db.getChapter(this.currentNovel.id, i);
            if (dbCh) {
                dbCh.title = newTitle;
                dbCh.updatedAt = nowISO;
                await this.db.saveChapter(this.currentNovel.id, i, dbCh);
            }
        }

        this.currentNovel.updatedAt = nowISO;
        const meta = this.novels.find(n => n.id === this.currentNovel.id);
        if (meta) meta.updatedAt = nowISO;
        this.scheduleFileSave();

        this.selectedChapterIndex = Math.min(this.selectedChapterIndex, chapterMetas.length - 1);
        this.showToast(`회차 번호가 1화 ~ ${chapterMetas.length}화로 정렬되었습니다.`);
        this.refreshChapterSidebar();
        this.refreshChapterContent();
    },

    renderChapterContentInner(chapter) {
    const novel = this.currentNovel;
    const ch = chapter || { title: '', content: '' };
    const currentChars = ch.content ? ch.content.length : 0;
    const currentCharsNoSpace = this.calculateCharsWithoutSpaces(ch.content);
    const targetChars = novel.targetChars || 5000;
    const progressPercent = Math.min(100, Math.round((currentChars / targetChars) * 100));
    const manuscriptPages = (currentChars / 200).toFixed(1);
    const statsHTML = `
        <div class="content-stats">
            <span>공백 포함: <font class="highlight">${currentChars.toLocaleString()}자</font></span>
            <span>공백 제외: <font class="mono">${currentCharsNoSpace.toLocaleString()}자</font></span>
            <span>원고지: <font class="mono">${manuscriptPages}매</font></span>
        </div>
    `;
    return `
        ${this.renderEntryHeader('chapter', ch.title, statsHTML)}
        <div class="content-toolbar">
            <div class="toolbar-row">
                <div class="toolbar-group">
                    <button onclick="app.correctCurrentChapterContent(${novel.id},${this.selectedChapterIndex})" class="btn btn-purple btn-sm">✨ 변환</button>
					<button onclick="app.copyCurrentChapterContent()" class="btn btn-soft btn-sm" title="회차 제목 없이 본문만 클립보드에 복사">📋 복사</button>
                    <button onclick="app.downloadCurrentChapter(${novel.id},${this.selectedChapterIndex})" class="btn btn-success btn-sm">TXT 저장</button>
                </div>
                <div class="toolbar-actions">
                    <button onclick="app.openMoveChapterModal()" class="btn btn-soft btn-sm" title="현재 회차를 다른 작품으로 이동">📤 회차 이동</button>
                    ${this.renderEntryMoveSelect('chapter')}
                    <button onclick="app.openEditChapterModal(${novel.id},${this.selectedChapterIndex})" class="btn btn-soft btn-sm">회차 수정</button>
                    <button onclick="app.deleteCurrentChapter(${novel.id},${this.selectedChapterIndex})" class="btn btn-danger btn-sm">삭제</button>
                </div>
            </div>
            <div class="toolbar-row">
                <div class="toolbar-group">
                    <select onchange="app.changeFontFamily(this.value)" class="toolbar-select">
                        <option value="font-nanumgothic" ${this.fontFamily === 'font-nanumgothic' ? 'selected' : ''}>나눔고딕</option>
                        <option value="font-nanummyeongjo" ${this.fontFamily === 'font-nanummyeongjo' ? 'selected' : ''}>나눔명조</option>
                        <option value="font-ridibatang" ${this.fontFamily === 'font-ridibatang' ? 'selected' : ''}>리디바탕</option>
                    </select>
                    <select onchange="app.changeLineHeight(this.value)" class="toolbar-select">
                        <option value="150%" ${this.lineHeight === '150%' ? 'selected' : ''}>줄간격 150%</option>
                        <option value="180%" ${this.lineHeight === '180%' ? 'selected' : ''}>줄간격 180%</option>
                        <option value="200%" ${this.lineHeight === '200%' ? 'selected' : ''}>줄간격 200%</option>
                        <option value="240%" ${this.lineHeight === '240%' ? 'selected' : ''}>줄간격 240%</option>
                    </select>
                    <div class="font-size-control">
                        <span class="label">글자</span>
                        <button onclick="app.changeFontSize(-1)">-</button>
                        <span class="value" id="fontSizeLabel">${this.fontSize}pt</span>
                        <button onclick="app.changeFontSize(1)">+</button>
                    </div>
                    <div class="font-size-control" title="본문 상하좌우 여백">
                        <span class="label">여백</span>
                        <button onclick="app.changeContentPadding(-4)">-</button>
                        <span class="value" id="paddingSizeLabel">${this.contentPadding}px</span>
                        <button onclick="app.changeContentPadding(4)">+</button>
                    </div>
                    <div class="search-inline">
                        <input type="text" id="internalSearchInput" placeholder="본문 검색..."
                               onkeydown="if(event.key==='Enter') app.handleInternalSearch(this.value)">
                        <button onclick="app.handleInternalSearch(document.getElementById('internalSearchInput').value)">🔍</button>
                    </div>
                </div>
            </div>
        </div>
        <div class="progress-wrap">
            <div class="progress-label">
                <span>목표 글자수 달성률 (${targetChars.toLocaleString()}자 기준)</span>
                <span class="pct" id="progressPct">${progressPercent}%</span>
            </div>
            <div class="progress-bar">
                <div class="progress-fill" id="progressFill" style="width: ${progressPercent}%;"></div>
            </div>
        </div>
        <div class="meta-row">
            <div>작성일: <span class="mono">${this.formatDate(ch.createdAt)}</span></div>
            <div>수정일: <span id="updatedAtDisplay" class="mono updated">${this.formatDate(ch.updatedAt || ch.createdAt)}</span></div>
        </div>
        <div id="chapterContentDisplay"
             class="content-display ${this.fontFamily}"
             style="font-size: ${this.fontSize}pt; line-height: ${this.lineHeight}; padding: ${this.contentPadding}px;"
             contenteditable="plaintext-only"
             oncompositionstart="app.isComposing = true"
             oncompositionend="app.isComposing = false; app.handleAutoSaveContent(${novel.id}, ${this.selectedChapterIndex}, this.innerText)"
             oninput="if(!app.isComposing) app.handleAutoSaveContent(${novel.id}, ${this.selectedChapterIndex}, this.innerText)"
             onblur="app.handleAutoSaveContent(${novel.id}, ${this.selectedChapterIndex}, this.innerText, true)"
        >${escapeHtml(ch.content || '').trim()}</div>
        <div class="content-hint">💡 본문을 직접 클릭하여 수정할 수 있으며 자동 저장됩니다.</div>
        <div class="panel comment-panel" id="chapterCommentPanel">
            <div class="comment-panel-header"><h4 class="comment-panel-title">💬 덧글</h4></div>
            <div class="comment-empty">불러오는 중…</div>
        </div>
        ${this.renderEntryBottomNav('chapter', this._chapterBottomNavExtraActions())}
    `;
},

    /* ── 자동저장 ── */
    handleAutoSaveContent(novelId, chapterIndex, newContent, immediate = false) {
        this._pendingAutoSave = { novelId, chapterIndex, content: newContent };
        clearTimeout(this.autoSaveTimer);
        const doSave = async () => { await this._flushPendingAutoSave(); };
        if (immediate) doSave();
        else this.autoSaveTimer = setTimeout(doSave, 1000);
    },

    async flushAutoSave() {
        clearTimeout(this.autoSaveTimer);
        this.autoSaveTimer = null;
        await this._flushPendingAutoSave();
    },

    /* 저장/변환 후 수정일·진행률 표시 갱신 */
    _updateChapterSavedUI(charCount, nowISO) {
        const updEl = document.getElementById('updatedAtDisplay');
        if (updEl) updEl.textContent = this.formatDate(nowISO);

        const target = this.currentNovel?.targetChars || 5000;
        const pct = Math.min(100, Math.round((charCount / target) * 100));
        const fill = document.getElementById('progressFill');
        const pctEl = document.getElementById('progressPct');
        if (fill) fill.style.width = `${pct}%`;
        if (pctEl) pctEl.textContent = `${pct}%`;
    },
    _saveDraft(novelId, chapterIndex, content) {
        try {
            localStorage.setItem(
                'novel_archive_draft',
                JSON.stringify({
                    novelId, chapterIndex, content,
                    savedAt: new Date().toISOString(),
                })
            );
        } catch (e) {}
    },
    _clearDraft() {
        try { localStorage.removeItem('novel_archive_draft'); } catch (e) {}
    },

    async _flushPendingAutoSave() {
        const pending = this._pendingAutoSave;
        if (!pending) return;
        this._pendingAutoSave = null;

        if (!this.currentNovel || this.currentNovel.id !== pending.novelId) return;

        let ch = null;
        if (Array.isArray(this.currentNovel.chapters) && this.currentNovel.chapters[pending.chapterIndex]) {
            ch = this.currentNovel.chapters[pending.chapterIndex];
        } else {
            ch = await this._ensureChapterAt(pending.chapterIndex);
        }
        if (!ch) return;

        this._saveDraft(pending.novelId, pending.chapterIndex, pending.content);

        const nowISO = new Date().toISOString();
        ch.content = pending.content;
        ch.updatedAt = nowISO;
        this.currentNovel.updatedAt = nowISO;

        // 사이드바 DOM 포함 메타 갱신
        this._updateChapterMeta(pending.chapterIndex, {
            charCount: pending.content.length,
            updatedAt: nowISO,
        });

        try {
            await this.db.saveChapter(pending.novelId, pending.chapterIndex, ch);
            await this._syncListMeta(pending.novelId);   // 목록의 총 글자수/수정일 반영
        } catch (e) {
            console.error('[autoSave] 저장 실패:', e);
            this.showToast('자동 저장 실패: ' + (e.message || '알 수 없는 오류'), 'error');
            this._pendingAutoSave = pending;
            return;
        }

        this._clearDraft();
        this._updateChapterSavedUI(pending.content.length, nowISO);
    },

    /* ── 회차 추가/수정/삭제 (모달 오픈) ── */
    async openAddChapterModal(novelId) {
        await this.flushAutoSave();
        const nextNum = this.getNextChapterNumber();
        document.getElementById('modalContent').innerHTML = this._renderModalShell({
            title: '새 회차 추가',
            formId: 'formAddChapter',
            onsubmit: `app.handleAddChapterSubmit(event, ${novelId})`,
            submitLabel: '추가',
            body: `
                <div class="form-group">
                    <label class="form-label">회차 제목</label>
                    <input type="text" id="chapTitle" class="input" value="${nextNum}화." required>
                </div>
                <div class="form-group">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.25rem;">
                        <label class="form-label" style="margin:0;">본문</label>
                        ${autoCorrectBlock('chapContent', 'handleChapTextFileUpload')}
                    </div>
                    <textarea id="chapContent" class="textarea" rows="16"></textarea>
                </div>
            `,
        });
        document.getElementById('modalOverlay').classList.remove('hidden');
    },

    async handleChapTextFileUpload(event) {
        const file = await this._loadTextFileInto(event, 'chapContent', {
            toast: '텍스트 업로드 및 자동 변환 완료',
        });
        if (!file) return;
        const t = document.getElementById('chapTitle');
        if (t && (!t.value || t.value.endsWith('.'))) t.value = file.name.replace(/\.[^/.]+$/, '');
    },

    async handleAddChapterSubmit(event, novelId) {
        event.preventDefault();
        const title = document.getElementById('chapTitle').value.trim();
        const content = (document.getElementById('chapContent').value || '').trim();
        await this.addEntrySubmit('chapter', { title, content });
    },

    async openEditChapterModal(novelId, chapterIndex) {
        await this.flushAutoSave();
        // ★ lazy 배열에서 본문 확보
        const ch = await this._ensureChapterAt(chapterIndex);
        if (!ch) { this.showToast('회차를 불러오지 못했습니다.', 'error'); return; }
        document.getElementById('modalContent').innerHTML = this._renderModalShell({
            title: '회차 수정',
            formId: 'formEditChapter',
            onsubmit: `app.handleEditChapterSubmit(event, ${novelId}, ${chapterIndex})`,
            submitLabel: '저장',
            body: `
                <div class="form-group">
                    <label class="form-label">회차 제목</label>
                    <input type="text" id="editChapTitle" class="input" value="${escapeHtml(ch.title)}" required>
                </div>
                <div class="form-group">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.25rem;">
                        <label class="form-label" style="margin:0;">본문</label>
                        ${autoCorrectBlock('editChapContent', 'handleEditChapTextFileUpload')}
                    </div>
                    <textarea id="editChapContent" class="textarea" rows="24">${escapeHtml(ch.content)}</textarea>
                </div>
            `,
        });
        document.getElementById('modalOverlay').classList.remove('hidden');
    },

    async handleEditChapterSubmit(event, novelId, chapterIndex) {
        event.preventDefault();
        const title = document.getElementById('editChapTitle').value.trim();
        const content = (document.getElementById('editChapContent').value || '').trim();
        await this.editEntrySubmit('chapter', { index: chapterIndex, title, content });
    },

    handleEditChapTextFileUpload(event) {
        return this._loadTextFileInto(event, 'editChapContent', { toast: '텍스트 교체 완료' });
    },

    /* ── 회차 삭제 래퍼 ── */
    async deleteCurrentChapter(novelId, chapterIndex) {
        return this.deleteEntry('chapter', novelId, chapterIndex);
    },

    /* ── 회차 순서 이동 래퍼 (entry-edit-base 의 moveEntryTo 위임) ── */
    async moveChapterTo(novelId, index, action) {
        return this.moveEntryTo('chapter', novelId, index, action);
    },

    /* ── 변환/검색/다운로드 ── */
    async correctCurrentChapterContent(novelId, chapterIndex) {
        if (!this.currentNovel) return;
        await this.flushAutoSave();
        const ch = await this._ensureChapterAt(chapterIndex);
        if (!ch) return;

        const displayEl = document.getElementById('chapterContentDisplay');
        const raw = displayEl ? displayEl.innerText : ch.content;
        const corrected = applyTextCorrections(raw);
        if (displayEl) displayEl.innerText = corrected;

        const nowISO = new Date().toISOString();
        ch.content = corrected;
        ch.updatedAt = nowISO;
        this.currentNovel.updatedAt = nowISO;
        this._updateChapterMeta(chapterIndex, { charCount: corrected.length, updatedAt: nowISO });

        try {
            await this.db.saveChapter(novelId, chapterIndex, ch);
            await this._syncListMeta(novelId);
        } catch (e) {
            console.error('[correct] 저장 실패:', e);
            this.showToast('저장 실패: ' + (e.message || '알 수 없는 오류'), 'error');
            return;
        }

        this.showToast('본문이 자동 변환되었습니다!');
        this._updateChapterSavedUI(corrected.length, nowISO);
        this.scheduleFileSave();
    },

    async handleInternalSearch(query) {
        if (this.activeDetailTab !== 'chapters') return;
        const displayEl = document.getElementById('chapterContentDisplay');
        if (!displayEl || !this.currentNovel) return;
        // ★ lazy 배열 대응
        const ch = await this._ensureChapterAt(this.selectedChapterIndex);
        if (!ch) return;
        const raw = ch.content || '';
        if (!query.trim()) { displayEl.innerText = raw.trim(); return; }
        const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(${escaped})`, 'gi');
        const html = escapeHtml(raw).replace(regex, '<span class="search-highlight">$1</span>');
        displayEl.innerHTML = html;
        const hl = displayEl.querySelector('.search-highlight');
        if (hl) {
            hl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            this.showToast(`'${query}' 검색 완료`);
        } else {
            this.showToast('일치하는 단어가 없습니다.', 'error');
        }
    },
	
	/* ── 본문만 클립보드로 복사 ── */
async copyCurrentChapterContent() {
    if (!this.currentNovel) return;

    // 화면에 보이는 본문(아직 자동저장 전인 수정 내용 포함)을 우선 사용
    const displayEl = document.getElementById('chapterContentDisplay');
    let text;
    if (displayEl) {
        text = displayEl.innerText;
    } else {
        const ch = await this._ensureChapterAt(this.selectedChapterIndex);
        text = ch ? (ch.content || '') : '';
    }
    text = (text || '').replace(/\u00A0/g, ' ').trim();

    if (!text) {
        this.showToast('복사할 본문이 없습니다.', 'error');
        return;
    }

    let ok = false;
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            ok = true;
        }
    } catch (e) {
        console.warn('[copy] clipboard API 실패, 폴백 사용:', e);
    }

    // 폴백: file:// 등 보안 컨텍스트가 아닌 환경 대응
    if (!ok) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed; top:0; left:0; opacity:0; pointer-events:none;';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        ta.remove();
    }

    if (ok) this.showToast(`본문이 복사되었습니다. (${text.length.toLocaleString()}자)`);
    else this.showToast('복사에 실패했습니다.', 'error');
},

    async downloadCurrentChapter(novelId, chapterIndex) {
        if (!this.currentNovel) return;
        const ch = await this._ensureChapterAt(chapterIndex);
        if (!ch) return;
        downloadBlob(
            new Blob([`${ch.title}\n\n${ch.content || ''}`], { type: 'text/plain;charset=utf-8' }),
            `${safeFileName(this.currentNovel.title)}_${safeFileName(ch.title)}.txt`
        );
        this.showToast('회차가 다운로드되었습니다.');
    },

    /* ── 회차를 다른 작품으로 이동 ── */
    async openMoveChapterModal() {
        await this.flushAutoSave();
        if (!this.currentNovel) return;
        const src = this.currentNovel;
        const metas = src.chapterMetas || [];
        if (metas.length <= 1) {
            this.showToast('회차가 1개뿐이라 이동할 수 없습니다.', 'error');
            return;
        }
        const others = this.novels.filter(n => n.id !== src.id);
        if (others.length === 0) {
            this.showToast('이동할 다른 작품이 없습니다.', 'error');
            return;
        }

        // ★ chapterMetas 기반으로 옵션 생성 (lazy chapters 배열과 무관)
        const chapterOptions = metas.map((meta, idx) => `
            <option value="${idx}" ${idx === this.selectedChapterIndex ? 'selected' : ''}>
                ${escapeHtml(meta.title || '')} (${meta.charCount || 0}자)
            </option>
        `).join('');

        const novelOptions = others
            .sort((a, b) => (a.title || '').localeCompare(b.title || '', 'ko'))
            .map(n => `<option value="${n.id}">${escapeHtml(n.title)} (${n.chapterCount || 0}화)</option>`)
            .join('');

        document.getElementById('modalContent').innerHTML = this._renderModalShell({
            title: '회차를 다른 작품으로 이동',
            formId: 'formMoveChapter',
            onsubmit: 'app.handleMoveChapterSubmit(event)',
            submitLabel: '이동',
            submitClass: 'btn btn-primary',
            body: `
                <div class="form-group">
                    <label class="form-label">현재 작품</label>
                    <input type="text" class="input" value="${escapeHtml(src.title)}" disabled>
                </div>
                <div class="form-group">
                    <label class="form-label">옮길 회차</label>
                    <select id="moveChapterSelect" class="select">
                        ${chapterOptions}
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">대상 작품</label>
                    <select id="moveTargetNovelSelect" class="select">
                        ${novelOptions}
                    </select>
                </div>
                <p style="font-size:0.75rem; color:var(--text-faint);">
                    ⚠️ 원본 작품에서 해당 회차가 삭제되며, 대상 작품의 맨 끝에 추가됩니다.<br>
                    ⚠️ 대상 작품의 회차 번호는 자동 재정렬되지 않습니다. 필요 시 "회차 번호 재정렬"을 사용하세요.
                </p>
            `,
        });
        document.getElementById('modalOverlay').classList.remove('hidden');
    },

     async handleMoveChapterSubmit(event) {
        event.preventDefault();
        await this.flushAutoSave();
        if (!this.currentNovel) return;

        const srcId = this.currentNovel.id;
        const chapterIdx = parseInt(document.getElementById('moveChapterSelect').value, 10);
        const dstId = parseInt(document.getElementById('moveTargetNovelSelect').value, 10);
        const srcMetas = this.currentNovel.chapterMetas || [];

        /* ── 1) 검증 (원본을 건드리기 전에 전부 끝낸다) ── */
        if (srcId === dstId) {
            this.showToast('같은 작품으로는 이동할 수 없습니다.', 'error');
            return;
        }
        if (!Number.isInteger(chapterIdx) || chapterIdx < 0 || chapterIdx >= srcMetas.length) {
            this.showToast('옮길 회차를 선택하세요.', 'error');
            return;
        }
        if (srcMetas.length <= 1) {
            this.showToast('회차가 1개뿐인 작품에서는 이동할 수 없습니다.', 'error');
            return;
        }
        const dstShell = await this.db.getNovelShell(dstId);
        if (!dstShell) {
            this.showToast('대상 작품을 불러오지 못했습니다.', 'error');
            return;
        }

        const nowISO = new Date().toISOString();

        /* ── 2) 이동 "전" 순서 기준으로 전체 본문 스냅샷 ──
           (로드 안 된 회차도 DB의 옛 인덱스로 정확히 읽어온다) */
        const snapshot = await this._snapshotAllChaptersInCurrentOrder();
        const [moved] = snapshot.splice(chapterIdx, 1);
        if (!moved) {
            this.showToast('회차를 찾을 수 없습니다.', 'error');
            return;
        }

        /* ── 3) DB 반영: 대상에 먼저 추가 → 원본 재기록
           (중간에 실패해도 회차가 사라지지 않고 중복만 남는 순서) */
        try {
            const dstCount = (dstShell.chapterMetas || []).length;
            await this.db.saveChapter(dstId, dstCount, { ...moved, updatedAt: nowISO });
            await this._bumpMetaCount(dstId, +1);
            await this.db.replaceChapters(srcId, snapshot);

            // ★ 덧글 보정: 옮긴 회차의 덧글은 대상 작품의 새 인덱스로, 나머지는 한 칸씩 당김
            const shift = ChapterIndexMap.remove(chapterIdx);
            await this.db.remapComments(srcId, (c) =>
                c.chapterIdx === chapterIdx
                    ? { novelId: dstId, chapterIdx: dstCount }
                    : { chapterIdx: shift(c.chapterIdx) }
            );
        } catch (e) {
            console.error('[moveChapter] 실패:', e);
            this.showToast('회차 이동 실패: ' + (e.message || '알 수 없는 오류'), 'error');
            return;
        }
        this._clearChapterCache();
        this._resetCommentUiState();            

        /* ── 4) 메모리 반영 (DB 성공 후) ── */
        srcMetas.splice(chapterIdx, 1);
        if (!Array.isArray(this.currentNovel.chapters)) this.currentNovel.chapters = [];
        this.currentNovel.chapters.length = 0;
        snapshot.forEach((ch, i) => { this.currentNovel.chapters[i] = ch; });
        this.currentNovel.updatedAt = nowISO;

        // 목록용 meta 동기화 (객체를 교체하지 않고 병합 → commentCount 등 메모리 전용 필드 보존)
        await this._syncListMeta(srcId);
        await this._syncListMeta(dstId);
        await this._syncListCommentCount(srcId);
        await this._syncListCommentCount(dstId);

        this.selectedChapterIndex = Math.min(chapterIdx, srcMetas.length - 1);
        this.closeModal();
        this.rebuildTagCache();
        this.showToast(`"${moved.title}"을(를) "${dstShell.title}"(으)로 이동했습니다.`);
        this.refreshChapterSidebar();
        this.refreshChapterContent();
        this.rememberPosition();
    },

    async downloadWholeNovel() {
        if (!this.currentNovel) return;
        const novel = this.currentNovel;
        const metas = novel.chapterMetas || [];
        if (metas.length === 0) {
            this.showToast('내보낼 회차가 없습니다.', 'error');
            return;
        }

        // ★ 메타 순서대로 회차 본문 확보 (lazy 배열 대응)
        const chapters = [];
        for (let i = 0; i < metas.length; i++) {
            const ch = await this._ensureChapterAt(i);
            chapters.push(ch || { title: metas[i].title || '', content: '' });
        }

        const statusInfo = getStatusInfo(novel.status || 'ongoing');
        const header = [
            `# ${novel.title}`, ``,
            novel.keyword ? `키워드: ${novel.keyword}` : '',
            `상태: ${statusInfo.emoji} ${statusInfo.label}`,
            `회차: ${chapters.length}화`,
            `총 글자수: ${(novel.totalChars || 0).toLocaleString()}자`,
            `내보낸 시각: ${this.formatDate(new Date().toISOString())}`, ``,
            `============================================================`, ``,
        ].filter(Boolean).join('\n');

        const body = chapters.map((ch, i) => {
            const title = ch.title || `${i + 1}화`;
            const content = ch.content || '';
            return `${title}\n\n${content}\n\n`;
        }).join('------------------------------------------------------------\n\n');

        downloadBlob(
            new Blob([header + body], { type: 'text/plain;charset=utf-8' }),
            `${safeFileName(novel.title)}_전체.txt`
        );
        this.showToast(`${chapters.length}개 회차를 내보냈습니다.`);
    }
});