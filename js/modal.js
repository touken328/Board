/* ============================================================
   MODAL 공통 + 새 작품 등록 + 작품 정보 수정
   ============================================================ */
const ModalMixin = {
    closeModal() {
        document.getElementById('modalOverlay').classList.add('hidden');
    },

    triggerAutoCorrect(textareaId) {
        const el = document.getElementById(textareaId);
        if (el) {
            el.value = applyTextCorrections(el.value);
            this.showToast('부호 및 오타가 자동 변환되었습니다.');
        }
    },

    _renderModalShell({ title, formId, onsubmit, body, submitLabel = '등록', submitClass = 'btn btn-primary' }) {
        return `
            <div class="modal-header">
                <h3 class="modal-title">${title}</h3>
                <button onclick="app.closeModal()" class="modal-close">✕</button>
            </div>
            <form id="${formId}" class="modal-body" onsubmit="${onsubmit}">
                ${body}
            </form>
            <div class="modal-footer">
                <button type="button" onclick="app.closeModal()" class="btn btn-soft">취소</button>
                <button type="submit" form="${formId}" class="${submitClass}">${submitLabel}</button>
            </div>
        `;
    },

    /* ── 새 작품 등록 ── */
    openNewPostModal() {
        const defColor = this.lastInput.color || '#f8c8dc';
        document.getElementById('modalContent').innerHTML = this._renderModalShell({
            title: '새 작품 등록',
            formId: 'formNewPost',
            onsubmit: 'app.handleCreatePost(event)',
            submitLabel: '등록하기',
            body: `
                <div class="form-group">
                    <label class="form-label">색상 라벨</label>
                    <div class="color-grid">${renderColorGrid('postColor', defColor)}</div>
                </div>
                <div class="form-group">
                    <label class="form-label">제목</label>
                    <input type="text" id="postTitle" class="input" placeholder="작품 제목" required>
                </div>
                <div class="form-group">
                    <label class="form-label">키워드 (쉼표로 구분)</label>
                    <input type="text" id="postKeyword" class="input" placeholder="예: 로맨스, 피폐물">
                </div>
				
                <div class="form-row-3">
                    <div class="form-group">
                        <label class="form-label">연재 상태</label>
                        <select id="postStatus" class="select">
                            <option value="ongoing" selected>📖 연재</option>
                            <option value="hiatus">📜 초고</option>
                            <option value="completed">💎 완결</option>
                            <option value="dropped">🌠 썰</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">회차당 목표 글자수</label>
                        <input type="number" id="postTargetChars" class="input" value="5000" step="500">
                    </div>
                    <div class="form-group">
                        <label class="form-label">성인 작품 체크</label>
                        <label class="checkbox-label checkbox-label--boxed">
                            <input type="checkbox" id="postIsAdult">🔞 19금
                        </label>
                    </div>
                </div>
				
                <div class="form-group">
                    <label class="form-label">첫 회차 제목</label>
                    <input type="text" id="postChapterTitle" class="input" value="1화." required>
				</div>
                <div class="form-group">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.25rem;">
                        <label class="form-label" style="margin:0;">본문 내용</label>
                        ${autoCorrectBlock('postContent', 'handleTextFileUpload')}
                    </div>
                    <textarea id="postContent" class="textarea" rows="16" placeholder="본문을 입력하거나 텍스트 파일을 업로드하세요."></textarea>
                </div>
            `,
        });
        document.getElementById('modalOverlay').classList.remove('hidden');
    },

    handleTextFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        const baseName = file.name.replace(/\.[^/.]+$/, '');
        const chInput = document.getElementById('postChapterTitle');

        // 회차 제목 자동 채우기:
        //   - 빈 값 → 파일명
        //   - 값이 있으면 사용자에게 확인 후 덮어쓰기
        if (chInput) {
            const cur = (chInput.value || '').trim();
            if (!cur) {
                chInput.value = baseName;
            } else if (cur !== baseName) {
                const ok = confirm(
                    `회차 제목이 이미 "${cur}"(으)로 입력되어 있습니다.\n` +
                    `파일명 "${baseName}"(으)로 덮어쓸까요?`
                );
                if (ok) chInput.value = baseName;
            }
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const ta = document.getElementById('postContent');
            if (ta) {
                ta.value = applyTextCorrections((e.target.result || '').trim());
                this.showToast('텍스트 업로드 및 자동 변환 완료');
            }
        };
        reader.readAsText(file, 'utf-8');
    },

    async handleCreatePost(event) {
        event.preventDefault();
        const color = (document.querySelector('input[name="postColor"]:checked') || {}).value || '#f8c8dc';
        const title = document.getElementById('postTitle').value.trim() || '무제 작품';
        const keyword = document.getElementById('postKeyword').value.trim();
        const targetChars = parseInt(document.getElementById('postTargetChars').value) || 5000;
        const chTitle = document.getElementById('postChapterTitle').value.trim() || '1화';
        const content = applyTextCorrections((document.getElementById('postContent').value || '').trim());
		const status = (document.getElementById('postStatus') || {}).value || 'ongoing';
        const isAdultEl = document.getElementById('postIsAdult');
        const isAdult = isAdultEl ? isAdultEl.checked : false;

        this.lastInput = { color, title, keyword };
        localStorage.setItem('novel_archive_last_input', JSON.stringify(this.lastInput));

        const nowISO = new Date().toISOString();
        const newId = this.novels.length > 0 ? Math.max(...this.novels.map(n => n.id)) + 1 : 1;
        const newNovel = {
            id: newId, color, title, keyword, targetChars, status, isAdult,
            settings: [{ title: '기본 설정', content: '내용 없음', createdAt: nowISO, updatedAt: nowISO }],
            chapters: [{ title: chTitle, content, createdAt: nowISO, updatedAt: nowISO }],
            createdAt: nowISO, updatedAt: nowISO,
        };
        const meta = await this.db.saveNovel(newNovel);
        this.novels.push(meta);
        this.rebuildTagCache();
        this.closeModal();
        this.showToast('새 작품이 등록되었습니다.');
        this.render();
    },

    /* ── 작품 정보 수정 ── */
    openEditNovelModal(novelId) {
        const novel = this.currentNovel;
        if (!novel) return;
        document.getElementById('modalContent').innerHTML = this._renderModalShell({
            title: '작품 정보 수정',
            formId: 'formEditNovel',
            onsubmit: `app.handleEditNovelSubmit(event, ${novelId})`,
            submitLabel: '수정 완료',
            submitClass: 'btn btn-purple',
            body: `
                <div class="form-group">
                    <label class="form-label">색상 라벨</label>
                    <div class="color-grid">${renderColorGrid('editNovelColor', novel.color)}</div>
                </div>
                <div class="form-group">
                    <label class="form-label">제목</label>
                    <input type="text" id="editNovelTitle" class="input" value="${escapeHtml(novel.title)}" required>
                </div>
                <div class="form-group">
                    <label class="form-label">키워드</label>
                    <input type="text" id="editNovelKeyword" class="input" value="${escapeHtml(novel.keyword || '')}">
                </div>
                <div class="form-row-3">
                    <div class="form-group">
                        <label class="form-label">연재 상태</label>
                        <select id="editNovelStatus" class="select">
                            <option value="ongoing"   ${(novel.status || 'ongoing') === 'ongoing'   ? 'selected' : ''}>📖 연재</option>
                            <option value="hiatus"    ${novel.status === 'hiatus'    ? 'selected' : ''}>📜 초고</option>
                            <option value="completed" ${novel.status === 'completed' ? 'selected' : ''}>💎 완결</option>
                            <option value="dropped"   ${novel.status === 'dropped'   ? 'selected' : ''}>🌠 썰</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">회차당 목표 글자수</label>
                        <input type="number" id="editNovelTarget" class="input"
                               value="${novel.targetChars || 5000}" step="500">
                    </div>
                    <div class="form-group">
                        <label class="form-label">성인 작품 체크</label>
                        <label class="checkbox-label checkbox-label--boxed">
                            <input type="checkbox" id="editNovelIsAdult" ${novel.isAdult ? 'checked' : ''}>🔞 19금
                        </label>
                    </div>
                </div>
            `,
        });
        document.getElementById('modalOverlay').classList.remove('hidden');
    },

        async handleEditNovelSubmit(event, novelId) {
        event.preventDefault();
        if (!this.currentNovel) return;

        const colorEl = document.querySelector('input[name="editNovelColor"]:checked');
        this.currentNovel.color = colorEl ? colorEl.value : this.currentNovel.color;

        const titleEl = document.getElementById('editNovelTitle');
        if (titleEl) this.currentNovel.title = titleEl.value.trim();

        const keywordEl = document.getElementById('editNovelKeyword');
        if (keywordEl) this.currentNovel.keyword = keywordEl.value.trim();

        const targetEl = document.getElementById('editNovelTarget');
        this.currentNovel.targetChars = targetEl ? (parseInt(targetEl.value) || 5000) : (this.currentNovel.targetChars || 5000);

        const statusEl = document.getElementById('editNovelStatus');
        this.currentNovel.status = statusEl ? statusEl.value : (this.currentNovel.status || 'ongoing');

        const isAdultEl = document.getElementById('editNovelIsAdult');
        this.currentNovel.isAdult = isAdultEl ? isAdultEl.checked : (this.currentNovel.isAdult === true);

        this.currentNovel.updatedAt = new Date().toISOString();
        await this.persistCurrentNovel();
        this.closeModal();
        this.showToast('작품 정보가 수정되었습니다.');
        this.render();
    }
};