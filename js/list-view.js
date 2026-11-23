/* ============================================================
   LIST VIEW: 목록 렌더, 검색/필터/정렬, 배치 태그, 선택 삭제
   ============================================================ */
const ListViewMixin = {
    /* ---------------- 캐시 ---------------- */
    rebuildTagCache() {
        const counts = {};
        for (const n of this.novels) {
            for (const t of parseTags(n.keyword)) counts[t] = (counts[t] || 0) + 1;
        }
        const allTags = Object.keys(counts).sort((a, b) =>
            counts[b] !== counts[a] ? counts[b] - counts[a] : a.localeCompare(b, 'ko')
        );
        this.tagCache = { counts, allTags };
    },
    getFilteredNovels() {
        const q = (this.searchQuery || '').trim().toLowerCase();
        const sel = this.selectedTag;
        const statusFilter = this.selectedStatus || 'all';
        const adultFilter = this.selectedAdult || 'all';

        const filtered = this.novels.filter(n => {
            // 상태
            if (statusFilter !== 'all' && (n.status || 'ongoing') !== statusFilter) return false;
            // 성인
            if (adultFilter === 'adult' && n.isAdult !== true) return false;
            if (adultFilter === 'normal' && n.isAdult === true) return false;
            // 태그
            const tags = parseTags(n.keyword);
            if (sel !== '전체' && !tags.includes(sel)) return false;
            // 검색어 (제목 또는 태그)
            if (q) {
                const inTitle = (n.title || '').toLowerCase().includes(q);
                const inTags = tags.some(t => t.toLowerCase().includes(q));
                if (!inTitle && !inTags) return false;
            }
            return true;
        });

        const cmp = SORT_COMPARATORS[this.sortOrder];
        if (cmp) filtered.sort(cmp);
        return filtered;
    },

    /* 헤더의 전역 누적 통계 갱신 */
    updateGlobalStats() {
        const elChars = document.getElementById('statChars');
        const elChapters = document.getElementById('statChapters');
        if (!elChars || !elChapters) return;

        let totalChars = 0;
        let totalChapters = 0;
        for (const n of this.novels) {
            totalChars += n.totalChars || 0;
            totalChapters += n.chapterCount || 0;
        }
        elChars.textContent = totalChars.toLocaleString();
        elChapters.textContent = totalChapters.toLocaleString();
    },

    _sortHeaderBtn(key, label, title) {
        const arrow = this.sortOrder === `${key}_desc` ? ' ▼' : this.sortOrder === `${key}_asc` ? ' ▲' : '';
        return `<button data-action="sort-by" data-sort-key="${key}" class="header-sort-btn" title="${title}">${label}</button>`;
    },

    renderListView() {
        const { counts: tagCounts, allTags } = this.tagCache;
        const paged = this.getPagedNovels();
        const filtered = paged.items;
        const total = paged.total;
        return `
            <div class="list-view">
                <div class="panel list-controls">
                    <div class="list-controls-left">
                        <span class="total-count">총 작품수: <strong>${this.novels.length}</strong>개${
                            total !== this.novels.length
                                ? ` <span style="color:var(--heading-accent);">(필터됨: ${total})</span>`
                                : ''
                        }</span>
                        <button onclick="app.toggleSelectAll(this)" class="btn btn-xs btn-soft">전체 선택</button>
                        <button onclick="app.openBatchTagModal()" class="btn btn-xs btn-purple">일괄 태그 관리</button>
                        <button onclick="app.deleteSelectedNovels()" class="btn btn-xs btn-danger">선택 삭제</button>
                    </div>
                    <div class="list-controls-right">
                        <button onclick="app.openNewPostModal()" class="btn btn-primary">
                            <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                            </svg>새 게시글
                        </button>
                        <select onchange="app.filterByTag(this.value)" class="select" style="width:auto;">
                            <option value="전체" ${this.selectedTag === '전체' ? 'selected' : ''}>태그 보기</option>
                            ${allTags.map(t => `<option value="${escapeHtml(t)}" ${this.selectedTag === t ? 'selected' : ''}>#${escapeHtml(t)} (${tagCounts[t]})</option>`).join('')}
                        </select>

                        <select onchange="app.changeSort(this.value)" class="select sort-select" style="width:auto;">
                            <optgroup label="업데이트순">
                                <option value="latest" ${this.sortOrder === 'latest' ? 'selected' : ''}>최신순</option>
                                <option value="oldest_updated" ${this.sortOrder === 'oldest_updated' ? 'selected' : ''}>오래된순</option>
                            </optgroup>
                            <optgroup label="등록순">
                                <option value="created_desc" ${this.sortOrder === 'created_desc' ? 'selected' : ''}>최신순</option>
                                <option value="created_asc" ${this.sortOrder === 'created_asc' ? 'selected' : ''}>오래된순</option>
                            </optgroup>
                            <optgroup label="색상 라벨순">
                                <option value="color_asc" ${this.sortOrder === 'color_asc' ? 'selected' : ''}>색상 라벨 ↑</option>
                                <option value="color_desc" ${this.sortOrder === 'color_desc' ? 'selected' : ''}>색상 라벨 ↓</option>
                            </optgroup>
                            <optgroup label="제목순">
                                <option value="title_asc" ${this.sortOrder === 'title_asc' ? 'selected' : ''}>가나다순</option>
                                <option value="title_desc" ${this.sortOrder === 'title_desc' ? 'selected' : ''}>역가나다순</option>
                            </optgroup>
                            <optgroup label="글자수 순">
                                <option value="chars_desc" ${this.sortOrder === 'chars_desc' ? 'selected' : ''}>많은순</option>
                                <option value="chars_asc" ${this.sortOrder === 'chars_asc' ? 'selected' : ''}>적은순</option>
                            </optgroup>
                            <optgroup label="회차 순">
                                <option value="chapters_desc" ${this.sortOrder === 'chapters_desc' ? 'selected' : ''}>많은순</option>
                                <option value="chapters_asc" ${this.sortOrder === 'chapters_asc' ? 'selected' : ''}>적은순</option>
                            </optgroup>
                        </select>
                    </div>
                </div>

                <div class="panel table-wrap">
                    <table class="novel-table">
                        <thead>
                            <tr>
                                <th style="width:3rem;"><button data-action="filter-adult" data-adult="all">#</button></th>
                                <th style="width:4rem;">${this._sortHeaderBtn('created', 'No', '클릭하여 등록순 정렬 (최신 ↔ 오래된)')}</th>
                                <th>${this._sortHeaderBtn('title', '제목', '클릭하여 제목순 정렬 (가나다 ↔ 역가나다)')}</th>
                                <th><button data-action="filter-tag" data-tag="전체">키워드</button></th>
                                <th style="width:5rem;">${this._sortHeaderBtn('chapters', '회차', '클릭하여 회차순 정렬 (많은순 ↔ 적은순)')}</th>
                                <th style="width:7rem; text-align:right;">${this._sortHeaderBtn('chars', '총 글자수', '클릭하여 글자수순 정렬 (많은순 ↔ 적은순)')}</th>
                                <th style="width:3.5rem; text-align:center;" title="연재/초고/완결/썰"><button data-action="filter-status" data-status="all">✒️</button></th>
                            </tr>
                        </thead>
                        <tbody>
                            ${filtered.length === 0
                                ? `<tr class="empty-row"><td colspan="7">조건에 일치하는 작품이 없습니다.</td></tr>`
                                : filtered.map(novel => this.renderNovelRow(novel)).join('')
                            }
                        </tbody>
                    </table>
                </div>

                ${this.renderPagination(paged)}

                <div class="panel search-panel">
                    <div class="search-row">
                        <div class="search-input-wrap">
                            <input type="text" id="searchInput" class="input search-input"
                                   placeholder="🔍 제목 또는 태그 검색"
                                   value="${escapeHtml(this.searchQuery)}"
                                   onkeydown="if(event.key==='Enter') app.executeSearch()">
                            <div class="search-actions">
                                <button onclick="app.executeSearch()" class="btn btn-accent btn-sm">검색</button>
                                <button onclick="app.resetSearch()" class="btn btn-soft btn-sm">초기화</button>
                            </div>
                        </div>
                    </div>

                    <div class="tag-filter-row">
                        <span class="tag-filter-label">📌 상태:</span>
                        <button data-action="filter-status" data-status="all" class="tag-pill ${this.selectedStatus === 'all' ? 'active' : ''}">전체</button>
                        ${Object.values(NOVEL_STATUS).map(s => `
                            <button data-action="filter-status" data-status="${s.id}"
                                    class="tag-pill ${this.selectedStatus === s.id ? 'active' : ''}">
                                ${s.emoji} ${s.label}
                            </button>`).join('')}
                    </div>

                    <div class="tag-filter-row">
                        <span class="tag-filter-label">🔞 성인:</span>
                        <button data-action="filter-adult" data-adult="all" class="tag-pill ${this.selectedAdult === 'all' ? 'active' : ''}">전체</button>
                        <button data-action="filter-adult" data-adult="adult" class="tag-pill ${this.selectedAdult === 'adult' ? 'active' : ''}">19금만</button>
                        <button data-action="filter-adult" data-adult="normal" class="tag-pill ${this.selectedAdult === 'normal' ? 'active' : ''}">일반만</button>
                    </div>

                    <div class="tag-filter-row">
                        <span class="tag-filter-label">🏷️ 태그:</span>
                        <button data-action="filter-tag" data-tag="전체" class="tag-pill ${this.selectedTag === '전체' ? 'active' : ''}">전체</button>
                        ${allTags.map(tag => `
                            <button data-action="filter-tag" data-tag="${escapeHtml(tag)}"
                                    class="tag-pill ${this.selectedTag === tag ? 'active' : ''}">
                                ${escapeHtml(tag)}
                            </button>`).join('')}
                    </div>

                </div>
            </div>
        `;
    },

    /* ── 페이지네이션 ── */
    getPagedNovels() {
        const filtered = this.getFilteredNovels();
        const total = filtered.length;
        const perPage = this.itemsPerPage || 15;
        const totalPages = Math.max(1, Math.ceil(total / perPage));

        if (this.currentPage > totalPages) this.currentPage = totalPages;
        if (this.currentPage < 1) this.currentPage = 1;

        const start = (this.currentPage - 1) * perPage;
        const end = start + perPage;
        return {
            items: filtered.slice(start, end),
            total,
            totalPages,
            perPage,
            start,
            end: Math.min(end, total),
        };
    },

    goToPage(page) {
        const { totalPages } = this.getPagedNovels();
        const target = Math.min(Math.max(1, page), totalPages);
        if (target === this.currentPage) return;
        this.currentPage = target;
        this.render();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    /* 페이지네이션 UI */
    renderPagination({ total, totalPages, start, end }) {
        if (total === 0) return '';

        const current = this.currentPage;

        // 페이지 번호를 최대 7개까지만 노출 (앞뒤 잘라내기)
        const WINDOW = 7;
        let startPage = Math.max(1, current - Math.floor(WINDOW / 2));
        let endPage = Math.min(totalPages, startPage + WINDOW - 1);
        if (endPage - startPage + 1 < WINDOW) {
            startPage = Math.max(1, endPage - WINDOW + 1);
        }

        const pageButtons = [];
        for (let p = startPage; p <= endPage; p++) {
            pageButtons.push(`
                <button onclick="app.goToPage(${p})"
                        class="page-btn ${p === current ? 'active' : ''}"
                        ${p === current ? 'disabled' : ''}>${p}</button>
            `);
        }

        return `
            <div class="pagination-bar">
                <div class="pagination-info">
                    ${start + 1}–${end} / ${total}개 (${current} / ${totalPages} 페이지)
                </div>
                <div class="pagination-controls">
                    <button onclick="app.goToPage(1)"  class="page-btn page-nav ${current === 1 ? 'disabled' : ''}"
                            ${current === 1 ? 'disabled' : ''}>« 처음</button>
                    <button onclick="app.goToPage(${current - 1})" class="page-btn page-nav ${current === 1 ? 'disabled' : ''}"
                            ${current === 1 ? 'disabled' : ''}>‹ 이전</button>
                    ${startPage > 1 ? `<span class="page-ellipsis">…</span>` : ''}
                    ${pageButtons.join('')}
                    ${endPage < totalPages ? `<span class="page-ellipsis">…</span>` : ''}
                    <button onclick="app.goToPage(${current + 1})" class="page-btn page-nav ${current === totalPages ? 'disabled' : ''}"
                            ${current === totalPages ? 'disabled' : ''}>다음 ›</button>
                    <button onclick="app.goToPage(${totalPages})"  class="page-btn page-nav ${current === totalPages ? 'disabled' : ''}"
                            ${current === totalPages ? 'disabled' : ''}>끝 »</button>
                </div>
            </div>
        `;
    },

    renderNovelRow(novel) {
    const tags = novel.keyword ? novel.keyword.split(',').map(t => t.trim()).filter(Boolean) : [];
    const hasSettings = novel.hasRichSettings === true;
    const totalChars = novel.totalChars || 0;
    const chapterCount = novel.chapterCount || 0;
    const statusInfo = getStatusInfo(novel.status || 'ongoing');
    return `
        <tr>
            <td class="cell-center">
                <input type="checkbox" data-id="${novel.id}" class="novel-checkbox">
            </td>
            <td class="cell-center id-cell">${novel.id}</td>
            <td class="cell-title">
                <a href="javascript:void(0)" onclick="app.goToDetail(${novel.id})" class="title-link">
                    <span class="color-dot" style="background-color:${novel.color || '#f8c8dc'};"></span>
                    ${escapeHtml(novel.title)}
                    ${novel.isAdult ? '<span class="badge-icon" title="성인 작품">🔞</span>' : ''}
                    ${hasSettings ? '<span class="badge-icon" title="설정 100자 이상 작성">🏷️</span>' : ''}
					<span class="cell-center comment-count">💬 ${novel.commentCount || 0}</span>
                </a>
            </td>
            <td class="tag-cell">
                ${tags.length
                    ? tags.map(t => `<span class="tag-inline" data-action="filter-tag" data-tag="${escapeHtml(t)}">*${escapeHtml(t)}</span>`).join(' ')
                    : '-'}
            </td>
            <td class="cell-center chapter-count">${chapterCount}화</td>
            <td class="cell-right char-count">${totalChars.toLocaleString()}자</td>
            <td class="cell-center status-cell">
                <span class="status-inline-icon"
                      data-action="filter-status"
                      data-status="${statusInfo.id}"
                      title="${statusInfo.label}"
                      style="cursor:pointer;">${statusInfo.emoji}</span>
            </td>
        </tr>
    `;
},
    /* 체크된 작품 id 목록 */
    _getCheckedNovelIds() {
        return Array.from(
            document.querySelectorAll('.novel-checkbox:checked'),
            cb => parseInt(cb.dataset.id, 10)
        );
    },

    /* 체크된 작품들의 meta 를 mutate 로 일괄 수정 → 저장 → 목록 반영
       - mutate(meta): meta 를 직접 수정
       - this.novels 는 객체를 교체하지 않고 병합해서 commentCount 같은 메모리 전용 필드를 보존한다 */
    async _batchUpdateMetas(mutate) {
        const ids = this._getCheckedNovelIds();
        if (ids.length === 0) {
            this.showToast('작품을 체크해주세요.', 'error');
            return 0;
        }
        const nowISO = new Date().toISOString();
        const metas = (await Promise.all(ids.map(id => this.db.getMeta(id)))).filter(Boolean);

        metas.forEach(m => { mutate(m); m.updatedAt = nowISO; });
        await this.db.putMetas(metas);

        for (const m of metas) {
            const local = this.novels.find(n => n.id === m.id);
            if (local) Object.assign(local, m);
        }
        this.rebuildTagCache();
        this.closeModal();
        this.render();
        return metas.length;
    },
    toggleSelectAll(btn) {
        const boxes = document.querySelectorAll('.novel-checkbox');
        const allChecked = Array.from(boxes).every(cb => cb.checked);
        boxes.forEach(cb => cb.checked = !allChecked);
        btn.textContent = allChecked ? '전체 선택' : '선택 해제';
    },

    executeSearch() {
        const input = document.getElementById('searchInput');
        if (input) this.searchQuery = input.value.toLowerCase();
        this.currentPage = 1;
        if (this.currentView === 'list') this.render();
    },
    resetSearch() {
        this.searchQuery = '';
        this.selectedTag = '전체';
        this.selectedStatus = 'all';
        this.selectedAdult = 'all';
        this.currentPage = 1;
        const input = document.getElementById('searchInput');
        if (input) input.value = '';
        if (this.currentView === 'list') this.render();
    },

    filterByTag(tag) { this.selectedTag = tag; this.currentPage = 1; this.render(); },
    changeSort(order) { this.sortOrder = order; this.currentPage = 1; this.render(); },

    /* ── 배치 태그 ── */
    openBatchTagModal() {
        const ids = this._getCheckedNovelIds();
        if (ids.length === 0) {
            this.showToast('태그를 관리할 작품을 체크해주세요.', 'error');
            return;
        }
        const allTags = this.tagCache.allTags;
        const content = document.getElementById('modalContent');
        content.innerHTML = `
            <div class="modal-header">
                <h3 class="modal-title">선택한 작품 일괄 태그/연령 표기 관리 (선택: ${ids.length}개)</h3>
                <button onclick="app.closeModal()" class="modal-close">✕</button>
            </div>
            <div class="modal-body">
                <div class="panel panel-pad">
                    <h4 style="font-weight:700; margin-bottom:0.5rem;">➕ 일괄 태그 추가</h4>
                    <p style="font-size:0.75rem; color:var(--text-faint); margin-bottom:0.75rem;">쉼표(,)로 구분</p>
                    <div style="display:flex; gap:0.5rem;">
                        <input type="text" id="batchAddTagInput" class="input" placeholder="예: 해피엔딩, 애절물">
                        <button onclick="app.handleBatchAddTag()" class="btn btn-primary">추가</button>
                    </div>
                </div>
                <div class="panel panel-pad">
                    <h4 style="font-weight:700; margin-bottom:0.5rem;">➖ 특정 태그 일괄 삭제</h4>
                    <p style="font-size:0.75rem; color:var(--text-faint); margin-bottom:0.75rem;">선택한 작품들에서 제거할 태그</p>
                    <div style="display:flex; gap:0.5rem;">
                        <select id="batchRemoveTagSelect" class="select">
                            <option value="">삭제할 태그 선택...</option>
                            ${allTags.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('')}
                        </select>
                        <button onclick="app.handleBatchRemoveTag()" class="btn btn-danger">삭제</button>
                    </div>
                </div>
                <div class="panel panel-pad">
                    <h4 style="font-weight:700; margin-bottom:0.5rem;">🔞 성인 여부 일괄 변경</h4>
                    <p style="font-size:0.75rem; color:var(--text-faint); margin-bottom:0.75rem;">선택한 작품들의 성인 여부를 한 번에 설정</p>
                    <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
                        <button onclick="app.handleBatchAdult(true)" class="btn btn-danger">🔞 19금으로 지정</button>
                        <button onclick="app.handleBatchAdult(false)" class="btn btn-success">🚫 일반으로 지정</button>
                    </div>
                </div>
            </div>
            <div class="modal-footer">
                <button onclick="app.closeModal()" class="btn btn-soft">닫기</button>
            </div>
        `;
        document.getElementById('modalOverlay').classList.remove('hidden');
    },

    async handleBatchAddTag() {
        const newTags = parseTags(document.getElementById('batchAddTagInput').value);
        if (newTags.length === 0) { this.showToast('추가할 태그를 입력하세요.', 'error'); return; }

        const n = await this._batchUpdateMetas(m => {
            const tags = parseTags(m.keyword);
            newTags.forEach(t => { if (!tags.includes(t)) tags.push(t); });
            m.keyword = tags.join(', ');
        });
        if (n) this.showToast('태그가 일괄 추가되었습니다.');
    },

    async handleBatchRemoveTag() {
        const tag = document.getElementById('batchRemoveTagSelect').value;
        if (!tag) { this.showToast('삭제할 태그를 선택하세요.', 'error'); return; }

        const n = await this._batchUpdateMetas(m => {
            m.keyword = parseTags(m.keyword).filter(t => t !== tag).join(', ');
        });
        if (n) this.showToast(`'${tag}' 태그가 삭제되었습니다.`);
    },

    async handleBatchAdult(makeAdult) {
        const count = this._getCheckedNovelIds().length;
        if (count === 0) { this.showToast('변경할 작품을 체크해주세요.', 'error'); return; }
        const label = makeAdult ? '19금' : '일반';
        if (!confirm(`선택한 ${count}개 작품을 "${label}"으로 일괄 변경하시겠습니까?`)) return;

        const n = await this._batchUpdateMetas(m => { m.isAdult = !!makeAdult; });
        if (n) this.showToast(`${n}개 작품을 "${label}"으로 변경했습니다.`);
    },

    async deleteSelectedNovels() {
        const ids = this._getCheckedNovelIds();
        if (ids.length === 0) { this.showToast('삭제할 작품을 선택하세요.', 'error'); return; }
        if (!confirm(`선택한 ${ids.length}개의 작품을 삭제하시겠습니까?`)) return;

        await Promise.all(ids.map(id => this.db.deleteNovel(id)));
        this.novels = await this.db.getAllMetas();

        // 남은 작품들에 덧글 수 재부착
        const commentCounts = await this.db.getCommentCountsByNovel();
        for (const m of this.novels) m.commentCount = commentCounts[m.id] || 0;

        this._clearChapterCache();   // ★ 새 작품 id 는 max+1 이라 삭제된 id 가 재사용될 수 있음
        this.rebuildTagCache();
        this.showToast('선택한 작품이 삭제되었습니다.');
        this.render();
    },
};