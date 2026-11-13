/* ============================================================
   SETTING EDIT: 설정 렌더/추가/수정/삭제/순서 이동
   ============================================================ */
const SettingEditMixin = Object.assign({}, EntryEditMixin, {
    /* ── ★ 신규: 설정만 저장 (회차 스토어 접근 없이) ──
       - contentStore 레코드 1개 put
       - meta: updatedAt / hasRichSettings만 갱신 (chapterCount, totalChars는 유지)
       - 이로써 설정 1개 수정 시 회차 25개 재기록이 발생하지 않음 */
    async _saveSettingsOnly(novelId, settings) {
        const sts = Array.isArray(settings) ? settings : [];
        const nowISO = new Date().toISOString();

        await new Promise((resolve, reject) => {
            const tx = this.db.db.transaction(
                [this.db.metaStore, this.db.contentStore],
                'readwrite'
            );
            const metaStore = tx.objectStore(this.db.metaStore);
            const contentStore = tx.objectStore(this.db.contentStore);

            // 설정 저장
            contentStore.put({
                id: novelId,
                data: JSON.stringify({ chapters: [], settings: sts }),
            });

            // meta 갱신 (chapterCount/totalChars 는 보존)
            const metaReq = metaStore.get(novelId);
            metaReq.onsuccess = () => {
                const meta = metaReq.result;
                if (!meta) return;
                meta.updatedAt = nowISO;
                meta.hasRichSettings = computeHasRichSettings(sts);
                metaStore.put(meta);
            };

            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('saveSettingsOnly aborted'));
        });

        // 메모리 상 novels 배열도 동기화
        const localMeta = this.novels.find(n => n.id === novelId);
        if (localMeta) {
            localMeta.updatedAt = nowISO;
            localMeta.hasRichSettings = computeHasRichSettings(sts);
        }
        this.scheduleFileSave();
    },

    /* ── ★ 신규: 설정 렌더 캐시 ──
       - 동일 설정 내용에 대해 parseMarkdown 반복 실행 방지
       - 설정 수정 시 해당 키 삭제 (아래 CRUD에서 처리) */
    _settingRenderCache: new Map(),

    _getSettingRenderKey(setting) {
        if (!setting) return '';
        // 내용 + 제목 + 폰트 크기/패밀리/줄간격 변경 시 재렌더 필요하므로 포함
        return [
            setting.title || '',
            setting.updatedAt || '',
            setting.content ? setting.content.length : 0,
            // 해시 대신 content 길이 + updatedAt 로 충분 (수정 시 updatedAt 갱신됨)
            this.fontFamily,
            this.fontSize,
            this.lineHeight,
        ].join('\u0001');
    },

    renderSettingSidebarInner() {
        return this.renderEntrySidebarInner('setting', '');
    },
    _settingBottomNavExtraActions() {
        const id = this.currentNovel?.id;
        const idx = this.selectedSettingIndex;
        return `
            <button onclick="app.switchDetailTab('chapters')" class="chapter-nav-btn">소설 본문</button>
            <span class="chapter-nav-sep">|</span>
            <button onclick="app.openAddSettingModal(${id})" class="chapter-nav-btn" title="새 설정 작성">+ 설정 추가</button>
            <span class="chapter-nav-sep">|</span>
            <button onclick="app.openEditSettingModal(${id},${idx})" class="chapter-nav-btn" title="설정 수정">✏️</button>
            <span class="chapter-nav-sep">|</span>
            <button onclick="app.deleteCurrentSetting(${id},${idx})" class="chapter-nav-btn" title="설정 삭제">🗑️</button>
            <span class="chapter-nav-sep">|</span>
        `;
    },

    renderSettingContentInner(setting) {
        const novel = this.currentNovel;
        const st = setting || { title: '', content: '' };
        const charCount = (st.content || '').length;
        const subtitleHTML = `<div class="content-subtitle">글자수: ${charCount.toLocaleString()}자</div>`;

        // ★ 렌더 캐시: 동일 설정을 반복 렌더할 때 parseMarkdown 재실행 방지
        const cacheKey = this._getSettingRenderKey(st);
        let rendered;
        const cached = this._settingRenderCache.get(cacheKey);
        if (cached) {
            rendered = cached;
        } else {
            rendered = this.parseMarkdown(st.content || '설정 내용이 없습니다.');
            // 캐시 크기 제한 (간단 LRU: 최대 20개)
            if (this._settingRenderCache.size >= 20) {
                const firstKey = this._settingRenderCache.keys().next().value;
                this._settingRenderCache.delete(firstKey);
            }
            this._settingRenderCache.set(cacheKey, rendered);
        }

        return `
            ${this.renderEntryHeader('setting', st.title, subtitleHTML)}
            <div class="content-header">
                <div class="content-header-right">
                    <div class="toolbar-actions">
                        ${this.renderEntryMoveSelect('setting')}
                        <button onclick="app.openEditSettingModal(${novel.id},${this.selectedSettingIndex})" class="btn btn-soft btn-sm">설정 수정</button>
                        <button onclick="app.deleteCurrentSetting(${novel.id},${this.selectedSettingIndex})" class="btn btn-danger btn-sm">삭제</button>
                    </div>
                </div>
            </div>
            <div id="settingContentDisplay"
                 class="content-display markdown-render setting-display ${this.fontFamily}"
                 style="font-size: ${this.fontSize}pt; line-height: ${this.lineHeight};">${rendered}</div>
            <div class="content-hint">📌 마크다운 : # 제목, ## 소제목, **굵은글씨**, *기울임*, &#96;형광펜&#96;, ~~취소선~~, --- 구분선<br>- 리스트, > 인용, | 표 |, |:좌측정렬|, |:중앙정렬:|, |우측정렬:|, ![이미지](http url)</div>
            ${this.renderEntryBottomNav('setting', this._settingBottomNavExtraActions())}
        `;
    },

    /* ── ★ 캐시 무효화 헬퍼 ── */
    _invalidateSettingRenderCache(setting) {
        if (!setting) {
            this._settingRenderCache.clear();
            return;
        }
        // 해당 설정의 현재/이전 키를 모두 삭제할 수는 없으므로,
        // updatedAt 이 바뀌면 자연히 키가 달라져 새로 렌더된다.
        // 다만 폰트/크기 변경으로 무효화가 필요할 때는 clear() 를 사용한다.
    },

    /* ── 추상 위임 (kind 전달) ── */
    async moveSettingTo(novelId, index, action) {
        return this.moveEntryTo('setting', novelId, index, action);
    },
    async deleteCurrentSetting(novelId, settingIndex) {
        return this.deleteEntry('setting', novelId, settingIndex);
    },
    async handleAddSettingSubmit(event, novelId) {
        event.preventDefault();
        const title = document.getElementById('settingTitle').value.trim();
        const content = (document.getElementById('settingContent').value || '').trim();
        await this.addEntrySubmit('setting', { title, content });
    },
    async handleEditSettingSubmit(event, novelId, settingIndex) {
        event.preventDefault();
        const title = document.getElementById('editSettingTitle').value.trim();
        const content = (document.getElementById('editSettingContent').value || '').trim();
        await this.editEntrySubmit('setting', { index: settingIndex, title, content });
    },

    /* ── ★ override: 설정 추가 — 회차 재기록 없이 contentStore만 갱신 ── */
    async addEntrySubmit(kind, payload) {
        if (kind !== 'setting') return EntryEditMixin.addEntrySubmit.call(this, kind, payload);
        await this.flushAutoSave();
        if (!this.currentNovel) return;

        const { title, content } = payload;
        const nowISO = new Date().toISOString();
        this.currentNovel.settings.push({ title, content, createdAt: nowISO, updatedAt: nowISO });
        this.currentNovel.updatedAt = nowISO;

        await this._saveSettingsOnly(this.currentNovel.id, this.currentNovel.settings);

        this._entry_setIndex('setting', this.currentNovel.settings.length - 1);
        this.closeModal();
        this.showToast(this._entry_getToastMessages('setting').added);
        this._entry_refreshSidebar('setting');
        this._entry_refreshContent('setting');
    },

    /* ── ★ override: 설정 수정 — 회차 재기록 없이 contentStore만 갱신 ── */
    async editEntrySubmit(kind, payload) {
        if (kind !== 'setting') return EntryEditMixin.editEntrySubmit.call(this, kind, payload);
        await this.flushAutoSave();
        if (!this.currentNovel) return;

        const { index, title, content } = payload;
        const arr = this.currentNovel.settings;
        if (!arr || !arr[index]) return;

        const nowISO = new Date().toISOString();
        Object.assign(arr[index], { title, content, updatedAt: nowISO });
        this.currentNovel.updatedAt = nowISO;

        await this._saveSettingsOnly(this.currentNovel.id, arr);

        // 렌더 캐시는 updatedAt 변경으로 자연 무효화되지만, 안전하게 정리
        this._invalidateSettingRenderCache(arr[index]);

        this.closeModal();
        this.showToast(this._entry_getToastMessages('setting').edited);
        this._entry_refreshSidebar('setting');
        this._entry_refreshContent('setting');
    },

    /* ── ★ override: 설정 삭제 — 회차 재기록 없이 contentStore만 갱신 ── */
    async deleteEntry(kind, novelId, index) {
        if (kind !== 'setting') return EntryEditMixin.deleteEntry.call(this, kind, novelId, index);
        await this.flushAutoSave();
        if (!this.currentNovel) return;

        const msgs = this._entry_getToastMessages('setting');
        const arr = this.currentNovel.settings;
        if (!Array.isArray(arr)) return;
        if (arr.length <= 1) { this.showToast(msgs.minOne, 'error'); return; }
        const target = arr[index];
        if (!target) return;
        if (!confirm(`"${target.title}" 설정을(를) 삭제하시겠습니까?`)) return;

        arr.splice(index, 1);
        this.currentNovel.updatedAt = new Date().toISOString();

        await this._saveSettingsOnly(novelId, arr);
        this._invalidateSettingRenderCache(target);

        this._entry_setIndex('setting', Math.max(0, index - 1));
        this.showToast(msgs.deleted);
        this._entry_refreshSidebar('setting');
        this._entry_refreshContent('setting');
    },

    /* ── ★ override: 설정 순서 이동 — 회차 재기록 없이 contentStore만 갱신 ── */
    async moveEntryTo(kind, novelId, index, action) {
        if (kind !== 'setting') return EntryEditMixin.moveEntryTo.call(this, kind, novelId, index, action);
        await this.flushAutoSave();
        if (!this.currentNovel) return;

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

        this._entry_setIndex('setting', newIndex);
        this.currentNovel.updatedAt = new Date().toISOString();

        await this._saveSettingsOnly(novelId, arr);

        this.showToast(`"${item.title}" 순서 변경`);
        this._entry_refreshSidebar('setting');
        this._entry_refreshContent('setting');
        this.rememberPosition();
    },

    /* ── 모달 오픈 ── */
    async openAddSettingModal(novelId) {
        await this.flushAutoSave();
        document.getElementById('modalContent').innerHTML = this._renderModalShell({
            title: '새 설정 노트 추가',
            formId: 'formAddSetting',
            onsubmit: `app.handleAddSettingSubmit(event, ${novelId})`,
            submitLabel: '추가',
            body: `
                <div class="form-group">
                    <label class="form-label">설정 제목</label>
                    <input type="text" id="settingTitle" class="input" placeholder="예: 주요 인물 소개" required>
                </div>
                <div class="form-group">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.25rem;">
                        <label class="form-label" style="margin:0;">설정 내용 (마크다운 지원)</label>
                        <div style="display:flex; gap:0.5rem;">
                            <button type="button" onclick="app.insertImageMarkdown('settingContent')" class="purple-button">🖼️ 이미지 url 추가</button>
                            <label class="cyan-button" style="cursor:pointer;">
                                텍스트 업로드
                                <input type="file" accept=".txt" onchange="app.handleSettingTextFileUpload(event)" hidden>
                            </label>
                        </div>
                    </div>
                    <textarea id="settingContent" class="textarea" rows="24"></textarea>
                    <div class="content-hint">📌 마크다운 : # 제목, ## 소제목, **굵은글씨**, *기울임*, &#96;형광펜&#96;, ~~취소선~~, --- 구분선, - 리스트, > 인용, | 표 |, ![이미지](http url)</div>
                </div>
            `,
        });
        document.getElementById('modalOverlay').classList.remove('hidden');
    },

    handleSettingTextFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        const baseName = file.name.replace(/\.[^/.]+$/, '');
        const t = document.getElementById('settingTitle');
        if (t && !t.value) t.value = baseName;
        const reader = new FileReader();
        reader.onload = (e) => {
            const ta = document.getElementById('settingContent');
            if (ta) {
                ta.value = (e.target.result || '').trim();
                this.showToast('텍스트 파일이 적용되었습니다.');
            }
        };
        reader.readAsText(file, 'utf-8');
    },

    async openEditSettingModal(novelId, settingIndex) {
        await this.flushAutoSave();
        const st = this.currentNovel && this.currentNovel.settings[settingIndex];
        if (!st) return;
        document.getElementById('modalContent').innerHTML = this._renderModalShell({
            title: '설정 노트 수정',
            formId: 'formEditSetting',
            onsubmit: `app.handleEditSettingSubmit(event, ${novelId}, ${settingIndex})`,
            submitLabel: '저장',
            body: `
                <div class="form-group">
                    <label class="form-label">설정 제목</label>
                    <input type="text" id="editSettingTitle" class="input" value="${escapeHtml(st.title)}" required>
                </div>
                <div class="form-group">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.25rem;">
                        <label class="form-label" style="margin:0;">설정 내용</label>
                        <div style="display:flex; gap:0.5rem;">
                            <button type="button" onclick="app.insertImageMarkdown('editSettingContent')" class="purple-button">🖼️ 이미지 url 추가</button>
                            <label class="cyan-button" style="cursor:pointer;">
                                텍스트 교체
                                <input type="file" accept=".txt" onchange="app.handleEditSettingTextFileUpload(event)" hidden>
                            </label>
                        </div>
                    </div>
                    <textarea id="editSettingContent" class="textarea" rows="24">${escapeHtml(st.content)}</textarea>
                    <div class="content-hint">📌 마크다운 : # 제목, ## 소제목, **굵은글씨**, *기울임*, &#96;형광펜&#96;, ~~취소선~~, --- 구분선, - 리스트, > 인용, | 표 |, ![이미지](http url)</div>
                </div>
            `,
        });
        document.getElementById('modalOverlay').classList.remove('hidden');
    },

    handleEditSettingTextFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            const ta = document.getElementById('editSettingContent');
            if (ta) {
                ta.value = (e.target.result || '').trim();
                this.showToast('텍스트 내용으로 교체되었습니다.');
            }
        };
        reader.readAsText(file, 'utf-8');
    },

    /* ── 커서 위치에 이미지 마크다운 삽입 ── */
    insertImageMarkdown(textareaId) {
        const ta = document.getElementById(textareaId);
        if (!ta) {
            this.showToast('입력창을 찾을 수 없습니다.', 'error');
            return;
        }
        const url = prompt('이미지 URL을 입력하세요.\n예: https://example.com/image.png');
        if (!url) return;
        const trimmed = url.trim();
        if (!/^(https?:\/\/|data:image\/|\/|\.\/|\.\.\/)/i.test(trimmed)) {
            this.showToast('http(s):// 또는 data:image/ 로 시작하는 URL만 사용할 수 있습니다.', 'error');
            return;
        }
        // ★ data:image/ 는 base64 로 매우 커질 수 있어 경고
        if (/^data:image\//i.test(trimmed) && trimmed.length > 500 * 1024) {
            if (!confirm('data:image URL이 500KB를 초과합니다.\n설정 저장 시 저장소 용량이 크게 늘어날 수 있습니다. 계속할까요?')) {
                return;
            }
        }
        const alt = (prompt('대체 텍스트(alt)를 입력하세요. 비워두셔도 됩니다.', '이미지') || '').trim();
        const md = `\n![${alt}](${trimmed})\n`;
        const start = ta.selectionStart ?? ta.value.length;
        const end   = ta.selectionEnd   ?? ta.value.length;
        const before = ta.value.slice(0, start);
        const after  = ta.value.slice(end);
        ta.value = before + md + after;
        const newPos = start + md.length;
        ta.focus();
        ta.setSelectionRange(newPos, newPos);
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        this.showToast('이미지 마크다운이 삽입되었습니다.');
    },
});