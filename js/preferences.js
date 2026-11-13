/* ============================================================
   PREFERENCES: 테마 / 폰트 / 크기 / 줄간격 / 토스트 / 키 이벤트
   NovelArchiveApp.prototype 에 병합되는 메서드 모음
   ============================================================ */
const PreferencesMixin = {
    initPreferences() {
        const fs = localStorage.getItem('novel_archive_fontsize');
        if (fs) this.fontSize = parseInt(fs, 10);
        const ff = localStorage.getItem('novel_archive_fontfamily');
        if (ff) { this.fontFamily = ff; FontLoader.ensure(ff); }
        const lh = localStorage.getItem('novel_archive_lineheight');
        if (lh) this.lineHeight = lh;
		const cp = localStorage.getItem('novel_archive_contentpadding');
        if (cp) this.contentPadding = parseInt(cp, 10);
    },

    initEventDelegation() {
        document.addEventListener('click', (e) => {
            const pill = e.target.closest('[data-action="filter-tag"]');
            if (pill) {
                e.stopPropagation();
                this.filterByTag(pill.dataset.tag);
                return;
            }
			const statusPill = e.target.closest('[data-action="filter-status"]');
            if (statusPill) {
                e.stopPropagation();
                this.selectedStatus = statusPill.dataset.status;
				this.currentPage = 1;
                this.render();
            }
            // ✅ 성인 필터 핸들러 추가
            const adultPill = e.target.closest('[data-action="filter-adult"]');
            if (adultPill) {
                e.stopPropagation();
                this.selectedAdult = adultPill.dataset.adult;
				this.currentPage = 1;
                this.render();
                return;
            }
            // ✅ No 헤더 클릭 → 등록순 정렬 토글
            const sortNumBtn = e.target.closest('[data-action="sort-by-number"]');
            if (sortNumBtn) {
                e.stopPropagation();
                // created_desc ↔ created_asc 토글, 그 외에는 created_desc 로 진입
                this.sortOrder = this.sortOrder === 'created_desc'
                    ? 'created_asc'
                    : 'created_desc';
                this.currentPage = 1;
                this.render();
                return;
            }
            // ✅ 회차 헤더 클릭 → 회차순 정렬 토글
            const sortChaptersBtn = e.target.closest('[data-action="sort-by-chapters"]');
            if (sortChaptersBtn) {
                e.stopPropagation();
                this.sortOrder = this.sortOrder === 'chapters_desc'
                    ? 'chapters_asc'
                    : 'chapters_desc';
                this.currentPage = 1;
                this.render();
                return;
            }
            // ✅ 범용 정렬 헤더 (data-sort-key 사용)
            const sortByBtn = e.target.closest('[data-action="sort-by"]');
            if (sortByBtn) {
                e.stopPropagation();
                const key = sortByBtn.dataset.sortKey;          // 'title' | 'chars' | ...
                const ascKey  = `${key}_asc`;
                const descKey = `${key}_desc`;
                const ascExists  = !!SORT_COMPARATORS[ascKey];
                const descExists = !!SORT_COMPARATORS[descKey];
                if (!ascExists || !descExists) {
                    console.warn(`[sort] 비교자 없음: ${key}_asc / ${key}_desc`);
                    return;
                }
                // 현재 정렬 상태에 따라 토글
                if (this.sortOrder === descKey)       this.sortOrder = ascKey;
                else if (this.sortOrder === ascKey)   this.sortOrder = descKey;
                else                                  this.sortOrder = descKey; // 처음엔 내림부터

                this.currentPage = 1;
                this.render();
                return;
            }
        });
    },

    initGlobalKeyEvents() {
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.closeModal();

            if (this.currentView === 'detail' && (e.key === 'Home' || e.key === 'End')) {
                if (this._isTypingContext()) return;
                e.preventDefault();
                window.scrollTo({
                    top: e.key === 'Home' ? 0 : document.body.scrollHeight,
                    behavior: 'smooth'
                });
            }
        });
    },
    _isTypingContext() {
        const el = document.activeElement;
        if (!el) return false;
        const tag = el.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
        if (el.isContentEditable) return true;
        return false;
    },

    initVisibilitySave() {
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState !== 'hidden') return;
            // ① IndexedDB 자동저장 flush (파일 미연결 사용자도 보존)
            if (typeof this.flushAutoSave === 'function') {
                this.flushAutoSave();
            }
            // ② 파일 연결 시 파일에도 저장
            if (this.fileHandle) {
                clearTimeout(this.fileSaveTimer);
                this.saveToFile();
            }
        });
    },

    /* 테마 */
    initTheme() {
        const saved = localStorage.getItem('novel_archive_theme');

        // 저장된 값이 없으면 시스템 설정(prefers-color-scheme)을 따름
        if (saved === 'dark') {
            this.isDarkMode = true;
            this.themeMode = 'dark';       // 수동 고정
        } else if (saved === 'light') {
            this.isDarkMode = false;
            this.themeMode = 'light';      // 수동 고정
        } else {
            this.themeMode = 'auto';       // 시스템 따라감
            this.isDarkMode = window.matchMedia &&
                window.matchMedia('(prefers-color-scheme: dark)').matches;
        }
        this.applyTheme();
        this.watchSystemTheme();
    },

    /* 시스템 테마 변경 감지 (auto 모드일 때만 반영) */
    watchSystemTheme() {
        if (!window.matchMedia) return;
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const handler = (e) => {
            if (this.themeMode === 'auto') {
                this.isDarkMode = e.matches;
                this.applyTheme();
            }
        };
        // addEventListener 미지원 구형 브라우저 폴백
        if (mq.addEventListener) mq.addEventListener('change', handler);
        else if (mq.addListener)  mq.addListener(handler);
    },
	
    toggleDarkMode() {
        this.isDarkMode = !this.isDarkMode;
        this.themeMode = this.isDarkMode ? 'dark' : 'light';   // 수동 고정
        localStorage.setItem('novel_archive_theme', this.themeMode);
        this.applyTheme();
    },
    applyTheme() {
        const htmlEl = document.documentElement;
        const btn = document.getElementById('themeToggleBtn');
        if (this.isDarkMode) {
            htmlEl.classList.add('dark');
            if (btn) btn.innerHTML = '☀️';
        } else {
            htmlEl.classList.remove('dark');
            if (btn) btn.innerHTML = '🌙';
        }
    },
	
	/* ── 실시간 시계 ── */
    initLiveClock() {
        // 이미 시작돼 있으면 중복 실행 방지
        if (this._clockTimer) return;

        const render = () => {
            const el = document.getElementById('liveClock');
            if (!el) return;

            const now = new Date();
            const weekdays = ['(일)', '(월)', '(화)', '(수)', '(목)', '(금)', '(토)'];
            const pad = (n) => String(n).padStart(2, '0');

            // 날짜: 10월 16일 금요일
            const dateStr = `${now.getMonth() + 1}월 ${now.getDate()}일 ${weekdays[now.getDay()]}`;

            // 오전/오후
            const hours24 = now.getHours();
            const ampm = hours24 < 12 ? '오전' : '오후';

            // 시간: 00:00:00 (24시간제로 표시 — 원하시면 12시간제로 바꿀 수 있음)
			const h12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
            const timeStr = `${pad(h12)}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

            // 텍스트 갱신
            el.querySelector('.live-clock-date').textContent = dateStr;
            el.querySelector('.live-clock-ampm').textContent = ampm;
            el.querySelector('.live-clock-time').textContent = timeStr;
        };

        render();                                  // 즉시 1회
        this._clockTimer = setInterval(render, 1000);  // 매초 갱신
    },

    /* Toast */
    showToast(message, type = 'success') {
        const container = document.getElementById('toastContainer');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = `toast ${type === 'error' ? 'error' : 'success'}`;
        toast.innerText = message;
        container.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('show'));
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    },

    /* 폰트/크기/줄간격 */
    changeFontSize(delta) {
        this.fontSize = Math.max(10, Math.min(22, this.fontSize + delta));
        localStorage.setItem('novel_archive_fontsize', this.fontSize);
        this.applyContentStyles();
    },
    changeFontFamily(cls) {
        FontLoader.ensure(cls);
        this.fontFamily = cls;
        localStorage.setItem('novel_archive_fontfamily', this.fontFamily);
        this.applyContentStyles();
    },
    changeLineHeight(lh) {
        this.lineHeight = lh;
        localStorage.setItem('novel_archive_lineheight', this.lineHeight);
        this.applyContentStyles();
    },
    changeContentPadding(delta) {
        this.contentPadding = Math.max(0, Math.min(64, this.contentPadding + delta));
        localStorage.setItem('novel_archive_contentpadding', this.contentPadding);
        this.applyContentStyles();
    },
    applyContentStyles() {
        const el = document.getElementById('chapterContentDisplay');
        if (el) {
            el.style.fontSize = `${this.fontSize}pt`;
            el.style.lineHeight = this.lineHeight;
			el.style.padding = `${this.contentPadding}px`;
            el.className = `content-display ${this.fontFamily}`;
        }
        const setEl = document.getElementById('settingContentDisplay');
        if (setEl) {
            setEl.style.fontSize = `${this.fontSize}pt`;
            setEl.style.lineHeight = this.lineHeight;
			setEl.style.padding = `${this.contentPadding}px`;
            setEl.className = `content-display markdown-render setting-display ${this.fontFamily}`;
        }
        const label = document.getElementById('fontSizeLabel');
        if (label) label.textContent = `${this.fontSize}pt`;
        const padLabel = document.getElementById('paddingSizeLabel');
        if (padLabel) padLabel.textContent = `${this.contentPadding}px`;
    }
};