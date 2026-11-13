/* ============================================================
   MARKDOWN HELPER: 연속된 <li> 를 <ul>/<ol> 로 감싼다
   ============================================================ */
function wrapListItems(html, markerClass, tag) {
    // markerClass(<ol>)가 있으면 class 제거 후 <ol>로 래핑
    if (markerClass) {
        return html.replace(
            new RegExp(`(?:<li class="${markerClass}">[\\s\\S]*?<\\/li>\\s*)+`, 'g'),
            (block) => {
                const cleaned = block
                    .replace(new RegExp(`<li class="${markerClass}">`, 'g'), '<li>')
                    .replace(/<\/li>\s+<li/g, '</li><li');
                return `<${tag}>${cleaned}</${tag}>`;
            }
        );
    }
    // 일반 <li> (md-ol-item 이 아닌 것)
    return html.replace(
        /(?:<li(?! class="md-ol-item")[^>]*>[\s\S]*?<\/li>\s*)+/g,
        (block) => {
            const cleaned = block.replace(/<\/li>\s+<li/g, '</li><li');
            return `<ul>${cleaned}</ul>`;
        }
    );
}

/* ============================================================
   MARKDOWN HELPER: 남은 텍스트 라인을 <p> 로 감싼다
   ============================================================ */
function wrapParagraphs(html) {
    const BLOCK_START = /^\s*<(?:ul|ol|table|blockquote|hr|h[1-4]|li|p)\b/i;
	const STANDALONE_IMG = /^\s*\[\[STANDALONE_IMG\]\]/;

    const lines = html.split('\n');
    const out = [];
    let buffer = [];

    const flush = () => {
        if (buffer.length === 0) return;
        const content = buffer.join('<br>').trim();
        if (content) out.push(`<p class="md-p">${content}</p>`);
        buffer = [];
    };

    for (const line of lines) {
        if (line.trim() === '') { flush(); continue; }
		if (STANDALONE_IMG.test(line)) {
            // 단독 이미지 → <p>로 감싸지 않고 그대로 통과
            flush();
            const cleaned = line
                .replace(/\[\[STANDALONE_IMG\]\]/g, '')
                .replace(/\[\[\/STANDALONE_IMG\]\]/g, '');
            out.push(cleaned);
            continue;
        }
        if (BLOCK_START.test(line)) { flush(); out.push(line); continue; }
        buffer.push(line);
    }
    flush();

    return out.join('\n');
}

/* ============================================================
   MARKDOWN TABLE PARSER
   ============================================================ */
function parseMarkdownTables(html) {
    const lines = html.split('\n');
    const result = [];
    let i = 0;

    const isPipeLine = (s) => /^\s*\|.*\|\s*$/.test(s);
    const isSepLine  = (s) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(s);

    const splitCells = (line) =>
        line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());

    const parseAlign = (sep) =>
        sep.replace(/\s/g, '').replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => {
            const left  = cell.startsWith(':');
            const right = cell.endsWith(':');
            if (left && right) return 'center';
            if (right)         return 'right';
            if (left)          return 'left';
            return '';
        });

    while (i < lines.length) {
        const head = lines[i];
        const sep  = lines[i + 1];

        if (isPipeLine(head) && sep !== undefined && isSepLine(sep)) {
            const headers = splitCells(head);
            const aligns  = parseAlign(sep);
            const rows    = [];
            let j = i + 2;

            while (j < lines.length && isPipeLine(lines[j])) {
                rows.push(splitCells(lines[j]));
                j++;
            }

            const thead = `<thead><tr>${
                headers.map((h, k) => {
                    const a = aligns[k] ? ` style="text-align:${aligns[k]};"` : '';
                    return `<th${a}>${h}</th>`;
                }).join('')
            }</tr></thead>`;

            const tbody = `<tbody>${
                rows.map(cells => `<tr>${
                    headers.map((_, k) => {
                        const a = aligns[k] ? ` style="text-align:${aligns[k]};"` : '';
                        return `<td${a}>${cells[k] !== undefined ? cells[k] : ''}</td>`;
                    }).join('')
                }</tr>`).join('')
            }</tbody>`;

            result.push(`<table class="md-table">${thead}${tbody}</table>`);
            i = j;
        } else {
            result.push(head);
            i++;
        }
    }
    return result.join('\n');
}

/* ============================================================
   DETAIL VIEW: 상세 화면 렌더링 + 부분 갱신
   ============================================================ */
const DetailViewMixin = {
    /* ── ★ 내부 헬퍼: 회차 메타 인덱스 정합성 보장 ──
       - shell 로드 후 currentNovel.chapters 를 chapterMetas 길이만큼 undefined 로 채움
       - 이미 로드된 회차는 보존 (덮어쓰지 않음) */
    _ensureChaptersArrayShape(novel) {
        if (!novel) return;
        const metas = Array.isArray(novel.chapterMetas) ? novel.chapterMetas : [];
        if (!Array.isArray(novel.chapters)) novel.chapters = [];
        const target = metas.length;
        if (novel.chapters.length < target) {
            for (let i = novel.chapters.length; i < target; i++) novel.chapters[i] = undefined;
        } else if (novel.chapters.length > target) {
            // 메타가 줄어든 경우(삭제 등) 초과분 정리
            novel.chapters.length = target;
        }
    },

    /* ── ★ 내부 헬퍼: 회차 본문을 currentNovel.chapters 에 반영 + chapterMetas 갱신 ──
       - ensureChapterLoaded 가 반환한 full 객체를 배열에 대입
       - chapterMetas[idx] 의 title/charCount/updatedAt 도 동기화 */
    _syncChapterIntoNovel(novel, idx, full) {
        if (!novel || !full) return;
        this._ensureChaptersArrayShape(novel);
        novel.chapters[idx] = full;

        const metas = novel.chapterMetas;
        if (Array.isArray(metas) && metas[idx]) {
            metas[idx].title = full.title || metas[idx].title || '';
            metas[idx].charCount = (full.content || '').length;
            if (full.updatedAt) metas[idx].updatedAt = full.updatedAt;
            if (full.createdAt) metas[idx].createdAt = full.createdAt;
        }
    },

    /* ── ★ 내부 헬퍼: 회차 인덱스 변경 시 사이드바 active 토글 ── */
    _setActiveChapterButton(idx) {
        document.querySelectorAll('[data-chapter-btn]').forEach(btn => {
            btn.classList.toggle('active', parseInt(btn.dataset.idx) === idx);
        });
    },

    render() {
        const view = document.getElementById('appView');
        if (!view) return;
        if (this.currentView === 'list') {
            view.innerHTML = this.renderListView();
            this._lastFilteredIds = this.getFilteredNovels().map(n => n.id);
        } else if (this.currentView === 'detail') {
            view.innerHTML = this.renderDetailView();
			if (typeof this.refreshChapterComments === 'function' && this.activeDetailTab === 'chapters') {
                this.refreshChapterComments();
            }
        }
        this.updateGlobalStats();
    },

    async goToList() {
        await this.flushAutoSave();
        this.currentView = 'list';
        this.selectedNovelId = null;
        this.currentNovel = null;
        this.render();
        window.scrollTo({ top: 0, behavior: 'auto' });
    },

    async goToDetail(novelId) {
        await this.flushAutoSave();
        // ★ LRU 캐시가 novelId:idx 키로 관리하므로 전체 클리어 불필요.
        //   (작품 전환 시 캐시 전체 삭제 → 돌아왔을 때 재로드되던 문제 해결)
        const shell = await this.db.getNovelShell(novelId);
        if (!shell) { this.showToast('작품을 찾을 수 없습니다.', 'error'); return; }

        this.currentNovel = shell;
        this.currentView = 'detail';
        this.selectedNovelId = novelId;

        // ★ shell 로드 직후 chapters 배열을 chapterMetas 길이에 맞춰 초기화
        this._ensureChaptersArrayShape(shell);
		
		const commentCounts = await this.db.getCommentCountsByChapter(novelId);
shell.chapterMetas.forEach((m, i) => { m.commentCount = commentCounts[i] || 0; });

        const storedNovelId = parseInt(localStorage.getItem('novel_archive_last_novel') || '0', 10);
        let restoreIdx = 0;
        if (storedNovelId === novelId) {
            const storedCh = parseInt(localStorage.getItem('novel_archive_last_chapter') || '0', 10);
            if (Number.isInteger(storedCh) && storedCh >= 0 && storedCh < shell.chapterMetas.length) {
                restoreIdx = storedCh;
            }
        }
        this.selectedChapterIndex = restoreIdx;
        this.selectedSettingIndex = 0;
        this.activeDetailTab = 'chapters';

        /* ★ 선택 회차 본문만 로드 + currentNovel.chapters[idx] 에 반영 */
        if (shell.chapterMetas.length > 0) {
            const loaded = await this.ensureChapterLoaded(novelId, restoreIdx);
            if (loaded) this._syncChapterIntoNovel(this.currentNovel, restoreIdx, loaded);
        }

        this.render();
        this.rememberPosition();
        window.scrollTo({ top: 0, behavior: 'auto' });
    },

    async switchDetailTab(tab) {
        await this.flushAutoSave();
        if (this.activeDetailTab === tab) return;
        this.activeDetailTab = tab;
        this.render();
        window.scrollTo({ top: 0, behavior: 'auto' });
    },

    refreshChapterContent() {
        const el = document.getElementById('chapterContentPanel');
        if (!el || !this.currentNovel) return;
        const idx = this.selectedChapterIndex;

        // ★ 1) currentNovel.chapters[idx] 우선, 2) 캐시, 3) chapterMetas 제목만이라도
        let ch = this.currentNovel.chapters ? this.currentNovel.chapters[idx] : null;
        if (!ch) {
            ch = this._getCachedChapter(this.currentNovel.id, idx);
            if (ch) {
                this._syncChapterIntoNovel(this.currentNovel, idx, ch);
            }
        }
        if (!ch) {
            const meta = this.currentNovel.chapterMetas && this.currentNovel.chapterMetas[idx];
            if (!meta) return;
            ch = { title: meta.title || '', content: '' };
        }
        el.innerHTML = this.renderChapterContentInner(ch);
		if (typeof this.refreshChapterComments === 'function') {
            this.refreshChapterComments();
        }
    },

    async selectChapter(idx) {
        await this.flushAutoSave();
        if (this.selectedChapterIndex === idx) return;

        /* ★ 본문 로드 후 currentNovel.chapters[idx] 에도 반영 */
        const loaded = await this.ensureChapterLoaded(this.currentNovel.id, idx);
        if (!loaded) { this.showToast('회차를 불러오지 못했습니다.', 'error'); return; }
        this._syncChapterIntoNovel(this.currentNovel, idx, loaded);

        this.selectedChapterIndex = idx;
        this._setActiveChapterButton(idx);
        this.refreshChapterContent();
        this.rememberPosition();
        window.scrollTo({ top: 0, behavior: 'auto' });
    },

    async goToPrevChapter() {
        await this.flushAutoSave();
        if (!this.currentNovel) return;
        if (this.selectedChapterIndex <= 0) { this.showToast('첫 번째 회차입니다.', 'error'); return; }
        const idx = this.selectedChapterIndex - 1;
        const loaded = await this.ensureChapterLoaded(this.currentNovel.id, idx);
        if (!loaded) return;
        this._syncChapterIntoNovel(this.currentNovel, idx, loaded);

        this.selectedChapterIndex = idx;
        this._setActiveChapterButton(idx);
        this.refreshChapterContent();
        this.rememberPosition();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    async goToNextChapter() {
        await this.flushAutoSave();
        if (!this.currentNovel) return;
        const total = this.currentNovel.chapterMetas.length;
        if (this.selectedChapterIndex >= total - 1) { this.showToast('마지막 회차입니다.', 'error'); return; }
        const idx = this.selectedChapterIndex + 1;
        const loaded = await this.ensureChapterLoaded(this.currentNovel.id, idx);
        if (!loaded) return;
        this._syncChapterIntoNovel(this.currentNovel, idx, loaded);

        this.selectedChapterIndex = idx;
        this._setActiveChapterButton(idx);
        this.refreshChapterContent();
        this.rememberPosition();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    async goToPrevNovel() {
        const list = this._lastFilteredIds || this.getFilteredNovels().map(n => n.id);
        const i = list.indexOf(this.selectedNovelId);
        if (i > 0) await this.goToDetail(list[i - 1]);
        else this.showToast('이전 작품이 없습니다.', 'error');
    },
    async goToNextNovel() {
        const list = this._lastFilteredIds || this.getFilteredNovels().map(n => n.id);
        const i = list.indexOf(this.selectedNovelId);
        if (i !== -1 && i < list.length - 1) await this.goToDetail(list[i + 1]);
        else this.showToast('다음 작품이 없습니다.', 'error');
    },

        renderDetailView() {
        const novel = this.currentNovel;
        if (!novel) return `<div style="text-align:center; padding:5rem;"><button onclick="app.goToList()" class="btn btn-soft">목록으로</button></div>`;

        const nowISO = new Date().toISOString();
        if (!novel.chapterMetas || novel.chapterMetas.length === 0) {
            novel.chapterMetas = [{ title: '1화', charCount: 0, createdAt: nowISO, updatedAt: nowISO }];
        }
        this._ensureChaptersArrayShape(novel);
        if (!novel.settings || novel.settings.length === 0) {
            novel.settings = [{ title: '기본 설정', content: '', createdAt: nowISO, updatedAt: nowISO }];
        }
        if (this.selectedChapterIndex >= novel.chapterMetas.length) this.selectedChapterIndex = 0;
        if (this.selectedSettingIndex >= novel.settings.length) this.selectedSettingIndex = 0;

        const tags = novel.keyword ? novel.keyword.split(',').map(t => t.trim()).filter(Boolean) : [];
        const hasSettings = this.hasValidSettings(novel);
        const totalChars = novel.totalChars || 0;
        // ★ 작품 전체 댓글 수 (chapterMetas 기반)
        const novelCommentTotal = (novel.chapterMetas || []).reduce(
            (sum, m) => sum + (m.commentCount || 0), 0
        );

        return `
            <div class="detail-view">
                <div class="panel detail-header">
                    <div class="detail-title-wrap">
                        <span class="color-dot" style="background-color:${novel.color || '#f8c8dc'};"></span>
                        <h2 class="detail-title">
                            ${escapeHtml(novel.title)}
                            ${novel.isAdult ? '<span class="badge-icon" title="19금 작품">🔞</span>' : ''}
                            <span class="status-badge status-${getStatusInfo(novel.status || 'ongoing').id}">
                                ${getStatusInfo(novel.status || 'ongoing').emoji} ${getStatusInfo(novel.status || 'ongoing').label}
                            </span>
                        </h2>
                    </div>

                    <div class="detail-title-row">
                        <div class="detail-tabs">
                            <button onclick="app.switchDetailTab('chapters')" class="tab-btn ${this.activeDetailTab === 'chapters' ? 'active' : ''}">연재 소설 본문</button>
                            <button onclick="app.switchDetailTab('settings')" class="tab-btn ${this.activeDetailTab === 'settings' ? 'active' : ''}">설정 및 메모 ${hasSettings ? '🏷️' : ''}</button>
                        </div>
                        <div class="detail-actions">
                            <button onclick="app.goToList()" class="btn btn-soft btn-sm">목록으로</button>
                            <button onclick="app.goToPrevNovel()" class="btn btn-soft btn-sm">▲ 이전글</button>
                            <button onclick="app.goToNextNovel()" class="btn btn-soft btn-sm">▼ 다음글</button>
                            <button onclick="app.downloadWholeNovel()" class="btn btn-success btn-sm">전체 저장</button>
                            <button onclick="app.openEditNovelModal(${novel.id})" class="btn btn-purple btn-sm">정보 수정</button>
                        </div>
                    </div>

                    <div class="keyword-row">
                        <div class="keyword-list">
                            <span class="label">키워드:</span>
                            ${tags.length
                                ? tags.map(t => `<span class="keyword-badge">#${escapeHtml(t)}</span>`).join('')
                                : '<span class="label">없음</span>'}
                        </div>
                        <div class="detail-stats">
                            본문 누적 글자수: <strong>${totalChars.toLocaleString()}자</strong>
                            ${novelCommentTotal > 0 ? ` · 💬 덧글 <strong>${novelCommentTotal}</strong>` : ''}
                        </div>
                    </div>
                </div>

                ${this.activeDetailTab === 'settings'
                    ? this.renderSettingsPanel()
                    : this.renderChaptersPanel()}
            </div>
        `;
    },

    renderChaptersPanel() {
        const idx = this.selectedChapterIndex;
        // ★ 우선순위: currentNovel.chapters[idx] → 캐시 → chapterMetas 제목만
        let chapter = this.currentNovel.chapters ? this.currentNovel.chapters[idx] : null;
        if (!chapter) chapter = this._getCachedChapter(this.currentNovel.id, idx);
        if (!chapter) {
            const meta = this.currentNovel.chapterMetas && this.currentNovel.chapterMetas[idx];
            chapter = { title: meta ? (meta.title || '') : '', content: '' };
        }
        return `
        <div class="detail-grid">
            <div class="panel sidebar" id="chapterSidebar">
                ${this.renderChapterSidebarInner()}
            </div>
            <div class="panel content-panel" id="chapterContentPanel">
                ${this.renderChapterContentInner(chapter)}
            </div>
        </div>
        `;
    },
    renderSettingsPanel() {
        const setting = this.currentNovel.settings[this.selectedSettingIndex];
        return `
            <div class="detail-grid">
                <div class="panel sidebar" id="settingSidebar">
                    ${this.renderSettingSidebarInner()}
                </div>
                <div class="panel content-panel" id="settingContentPanel">
                    ${this.renderSettingContentInner(setting)}
                </div>
            </div>
        `;
    },

    /* ── 부분 DOM 갱신 ── */
    refreshChapterSidebar() {
        const el = document.getElementById('chapterSidebar');
        if (el) el.innerHTML = this.renderChapterSidebarInner();
    },
    refreshSettingSidebar() {
        const el = document.getElementById('settingSidebar');
        if (el) el.innerHTML = this.renderSettingSidebarInner();
    },
    refreshSettingContent() {
        const el = document.getElementById('settingContentPanel');
        if (el && this.currentNovel) {
            const st = this.currentNovel.settings[this.selectedSettingIndex];
            if (!st) return;
            el.innerHTML = this.renderSettingContentInner(st);
        }
    },

    selectSetting(idx) {
        if (this.selectedSettingIndex === idx) return;
        this.selectedSettingIndex = idx;
        document.querySelectorAll('[data-setting-btn]').forEach(btn => {
            btn.classList.toggle('active', parseInt(btn.dataset.idx) === idx);
        });
        this.refreshSettingContent();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    /* ── 이전/다음 설정 이동 ── */
    goToPrevSetting() {
        if (!this.currentNovel) return;
        if (this.selectedSettingIndex <= 0) {
            this.showToast('첫 번째 설정입니다.', 'error');
            return;
        }
        this.selectedSettingIndex -= 1;
        document.querySelectorAll('[data-setting-btn]').forEach(btn => {
            btn.classList.toggle('active', parseInt(btn.dataset.idx) === this.selectedSettingIndex);
        });
        this.refreshSettingContent();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    goToNextSetting() {
        if (!this.currentNovel) return;
        const total = this.currentNovel.settings.length;
        if (this.selectedSettingIndex >= total - 1) {
            this.showToast('마지막 설정입니다.', 'error');
            return;
        }
        this.selectedSettingIndex += 1;
        document.querySelectorAll('[data-setting-btn]').forEach(btn => {
            btn.classList.toggle('active', parseInt(btn.dataset.idx) === this.selectedSettingIndex);
        });
        this.refreshSettingContent();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    /* ── 유틸(뷰 전용) ── */
    formatDate(isoString) {
        if (!isoString) return '-';
        const d = new Date(isoString);
        const pad = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}.${pad(d.getMonth()+1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    },
    calculateCharsWithoutSpaces(text) {
        if (!text) return 0;
        return text.replace(/\s+/g, '').length;
    },
    hasValidSettings(novel) { return computeHasRichSettings(novel.settings); },

    parseMarkdown(text) {
        if (!text) return '';
        let out = escapeHtml(text);

        // ── 표 (파이프 문법) ──
        out = parseMarkdownTables(out);

        // ── 수평선 ──
        out = out.replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, '<hr class="md-hr">');

        // ── 인용구 (연속 병합) ──
        out = out.replace(
            /(?:^&gt;[^\n]*(?:\n|$))+/gm,
            (block) => {
                const inner = block
                    .replace(/\n$/, '')
                    .split('\n')
                    .map(line => line.replace(/^&gt;\s?/, ''))
                    .join('<br>');
                return `<blockquote class="md-quote">${inner}</blockquote>\n`;
            }
        );

        // ── 체크리스트 ──
        out = out.replace(/^[-*]\s+\[\s\]\s+(.*)$/gm, '<li class="md-task"><input type="checkbox" disabled> $1</li>');
        out = out.replace(/^[-*]\s+\[[xX]\]\s+(.*)$/gm, '<li class="md-task"><input type="checkbox" checked disabled> $1</li>');

        // ── 리스트 ──
        out = out.replace(/^[-*]\s+(?!\[[ xX]\])(.*)$/gm, '<li>$1</li>');

        // ── 헤딩 ──
        out = out.replace(/^####\s+(.*)$/gm, '<h5>$1</h5>');
        out = out.replace(/^###\s+(.*)$/gm,  '<h4>$1</h4>');
        out = out.replace(/^##\s+(.*)$/gm,   '<h3>$1</h3>');
        out = out.replace(/^#\s+(.*)$/gm,    '<h2>$1</h2>');

        // ── 인라인 요소 ──

        // 이미지: ![alt](url)  ※ 다른 인라인보다 먼저 처리
        out = out.replace(
            /!\[([^\]]*)\]\(([^)\s]+)\)/g,
            (match, alt, url) => {
                // URL 안전성 검사: http(s), data:image, 상대경로만 허용
                if (!/^(https?:\/\/|data:image\/|\/|\.\/|\.\.\/)/i.test(url)) {
                    return match;   // javascript: 등 위험 스킴은 원본 텍스트 그대로
                }
                const safeAlt = alt.replace(/"/g, '&quot;');
                const safeUrl = url.replace(/"/g, '&quot;');
				return `<img class="md-img" src="${safeUrl}" alt="${safeAlt}" loading="lazy" referrerpolicy="no-referrer">`;
            }
        );
		
        // 이미지 단독 라인 감지: 한 줄에 <img> 하나만 있는 라인은
        //    wrapParagraphs 에서 <p>로 감싸지 않도록 마커를 붙여둔다
        out = out.replace(
            /^(\s*)(<img[^>]*>)(\s*)$/gm,
            (match, sp1, img, sp2) => `${sp1}[[STANDALONE_IMG]]${img}[[/STANDALONE_IMG]]${sp2}`
        );

        // 취소선
        out = out.replace(/~~(.*?)~~/g, '<del>$1</del>');

        // 기울임
        out = out.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');

        // 굵게
        out = out.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

        // 형광펜
        out = out.replace(/`([^`\n]+?)`/g, '<mark class="md-mark">$1</mark>');

        // ── 리스트 래핑 & 문단 래핑 ──
        out = wrapListItems(out, null,          'ul');
        out = wrapParagraphs(out);
		
		// 마커 정리 (혹시 wrapParagraphs가 처리 못한 경우 대비)
        out = out.replace(/\[\[STANDALONE_IMG\]\]/g, '')
                 .replace(/\[\[\/STANDALONE_IMG\]\]/g, '');

        return out;
    }
};