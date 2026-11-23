/* ============================================================
   FILE SYNC: 파일 연결/저장, JSON 백업/복원
   ============================================================ */
const JSON_MIME = 'application/json;charset=utf-8';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const FileSyncMixin = {
    /* ────────────────────────────────────────────────────────────
       공통 1) 작품을 하나씩 JSON 문자열로 만드는 제너레이터
       - 한 번에 한 작품만 메모리에 올린다
       ──────────────────────────────────────────────────────────── */
    async *_iterNovelJson(metas) {
        const list = metas || await this.db.getAllMetas();
        for (const m of list) {
            const novel = await this.db.getNovelById(m.id);
            if (novel) yield JSON.stringify(novel, null, 2);
        }
    },

    /* 공통 2) 전체 작품을 JSON 배열로 파일 핸들에 기록 */
    async _writeAllToHandle(handle) {
        const writable = await handle.createWritable();
        await writable.write('[\n');
        let first = true;
        for await (const json of this._iterNovelJson()) {
            await writable.write((first ? '' : ',\n') + json);
            first = false;
        }
        await writable.write('\n]');
        await writable.close();
    },

    /* 공통 3) JSON 파일들을 DB로 가져오기 (기존 데이터 초기화 후 5개씩 배치 저장)
       - 반환: 저장한 작품 수 */
    async _importJsonFiles(files, ctrl) {
        const BATCH = 5;
        let pending = [];
        let saved = 0;

        const flush = async () => {
            if (!pending.length) return;
            if (ctrl.signal.aborted) throw new DOMException('Aborted', 'AbortError');
            await this.db._putNovelsChunk(pending);
            saved += pending.length;
            pending = [];
            ctrl.update({ done: saved, total: Math.max(saved, 1), phase: 'save' });
            await sleep(0);
        };

        ctrl.update({ done: 0, total: files.length, phase: 'clear' });
        await this.db._clearAllStores();

        for (let i = 0; i < files.length; i++) {
            if (ctrl.signal.aborted) throw new DOMException('Aborted', 'AbortError');
            ctrl.update({ done: i, total: files.length, phase: 'read' });
            await streamJsonArray(files[i], async (item) => {
                pending.push(item);
                if (pending.length >= BATCH) await flush();
            }, { signal: ctrl.signal });
            await flush();   // 파일 경계에서 남은 배치 저장
        }
        return saved;
    },

    /* 공통 4) 가져오기 후 화면/상태 갱신 */
    async _afterImport() {
        this.novels = await this.db.getAllMetas();
        try {
            const counts = await this.db.getCommentCountsByNovel();
            for (const m of this.novels) m.commentCount = counts[m.id] || 0;
        } catch (e) {
            for (const m of this.novels) m.commentCount = 0;
        }
        this._clearChapterCache?.();
        this.rebuildTagCache();
        this.render();
        this.updateGlobalStats();
    },

    _closeRestoreProgress() {
        this._restoreProgressEl?.remove();
        this._restoreProgressEl = null;
    },

    /* ── 파일 연결 ── */
    async connectFile() {
        if (!window.showOpenFilePicker) {
            this.showToast('이 브라우저는 File System Access API를 지원하지 않습니다.', 'error');
            return;
        }
        try {
            const [handle] = await window.showOpenFilePicker({
                types: [{ description: 'JSON Files', accept: { 'application/json': ['.json'] } }],
                multiple: false,
            });
            this.fileHandle = handle;
            const file = await handle.getFile();

            const ctrl = this._showRestoreProgress();
            const saved = await this._importJsonFiles([file], ctrl);
            ctrl.close();

            await this._afterImport();
            this.updateFileButtonsState(true, file.name);
            this.showToast(`'${file.name}' 파일이 연결 및 로드되었습니다. (${saved}개)`);
        } catch (err) {
            this._closeRestoreProgress();
            if (err.name !== 'AbortError') {
                console.error(err);
                this.showToast(`파일 연결 실패: ${err.message}`, 'error');
            }
        }
    },

    /* ── 분할 다운로드 (그룹이 5MB 를 넘으면 즉시 파일로 내보내고 버퍼 해제) ── */
    async downloadJSONSplit() {
        if (this._isBackingUp) {
            this.showToast('이미 백업이 진행 중입니다.', 'error');
            return;
        }
        this._isBackingUp = true;

        try {
            await this.flushAutoSave?.();

            const TARGET_BYTES = 5 * 1024 * 1024;
            const SEP_BYTES = 2;                         // 작품 사이 `,\n` 여유치
            const encoder = new TextEncoder();

            const metas = await this.db.getAllMetas();
            if (metas.length === 0) {
                this.showToast('백업할 데이터가 없습니다.', 'error');
                return;
            }

            const dateStr = formatYmd();
            let group = [];
            let groupBytes = 2;                          // '[' + ']'
            let partIndex = 0;
            let totalNovels = 0;

            const flushGroup = async () => {
                if (!group.length) return;
                partIndex++;
                const blob = new Blob(['[', group.join(',\n'), ']'], { type: JSON_MIME });
                downloadBlob(blob, `novel_archive_${dateStr}_part${partIndex}.json`);
                group = [];
                groupBytes = 2;
                await sleep(300);
            };

            this.showToast('분할 다운로드를 시작합니다...');

            for await (const serialized of this._iterNovelJson(metas)) {
                const bytes = encoder.encode(serialized).length;
                totalNovels++;

                // 작품 하나가 목표보다 크면 단독 파일
                if (bytes > TARGET_BYTES) {
                    await flushGroup();
                    group = [serialized];
                    await flushGroup();
                    continue;
                }

                const add = bytes + (group.length ? SEP_BYTES : 0);
                if (group.length && groupBytes + add > TARGET_BYTES) await flushGroup();

                groupBytes += bytes + (group.length ? SEP_BYTES : 0);
                group.push(serialized);
            }
            await flushGroup();

            this.showToast(`분할 백업 완료 (${partIndex}개 파일, ${totalNovels}개 작품)`);
        } catch (err) {
            console.error(err);
            this.showToast('분할 다운로드 중 오류가 발생했습니다.', 'error');
        } finally {
            this._isBackingUp = false;
        }
    },

    /* ── 복원 (다중 파일) ── */
    async restoreMultipleJSON(event) {
        const files = Array.from(event.target.files);
        if (files.length === 0) return;
        event.target.value = '';

        if (!confirm(`총 ${files.length}개의 파일을 복원하시겠습니까?\n현재 데이터는 모두 덮어씌워집니다.`)) return;

        const ctrl = this._showRestoreProgress();
        try {
            const saved = await this._importJsonFiles(files, ctrl);
            if (saved === 0) throw new Error('유효한 데이터가 없습니다.');

            ctrl.close();
            await this._afterImport();
            this.showToast(`성공적으로 복원되었습니다. (${saved}개 작품)`);
        } catch (err) {
            this._closeRestoreProgress();
            if (err.name === 'AbortError') {
                this.showToast('복원이 취소되었습니다.', 'error');
            } else {
                console.error(err);
                this.showToast(`복원 실패: ${err.message || '알 수 없는 오류'}`, 'error');
            }
        }
    },

    /* ── 진행률 모달 ── */
    _showRestoreProgress() {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.style.zIndex = '9999';
        overlay.innerHTML = `
            <div class="modal" style="max-width:420px;">
                <div class="modal-header">
                    <h3 class="modal-title">JSON 복원 중…</h3>
                </div>
                <div class="modal-body">
                    <div class="progress-wrap" style="margin:0;">
                        <div class="progress-label">
                            <span id="restorePhase">준비 중…</span>
                            <span class="pct" id="restorePct">0%</span>
                        </div>
                        <div class="progress-bar">
                            <div class="progress-fill" id="restoreFill" style="width:0%;"></div>
                        </div>
                    </div>
                    <p style="font-size:0.75rem; color:var(--text-faint); margin-top:0.75rem;">
                        ⚠️ 창을 닫거나 새로고침하지 마세요.
                    </p>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-soft" id="restoreCancelBtn">취소</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        this._restoreProgressEl = overlay;

        const controller = new AbortController();
        const fill = overlay.querySelector('#restoreFill');
        const pct = overlay.querySelector('#restorePct');
        const phase = overlay.querySelector('#restorePhase');

        overlay.querySelector('#restoreCancelBtn').addEventListener('click', () => controller.abort());

        const PHASE_LABELS = {
            read:  (done, total) => `파일 읽는 중… (${done + 1} / ${total})`,
            clear: () => '기존 데이터 초기화 중…',
            save:  (done, total) => `DB에 저장 중… (${done} / ${total})`,
            done:  () => '완료',
        };

        const update = ({ done, total, phase: ph }) => {
            const p = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
            fill.style.width = `${p}%`;
            pct.textContent = `${p}%`;
            const labelFn = PHASE_LABELS[ph];
            if (labelFn) phase.textContent = labelFn(done, total);
        };

        const close = () => {
            overlay.remove();
            this._restoreProgressEl = null;
        };

        return { signal: controller.signal, update, close };
    },

    /* ── 연결 파일 저장 (File System Access) ── */
    async saveToFile() {
        if (!this.fileHandle) { await this.saveAsNewFile(); return; }
        if (this._isFileSaving) {
            this.scheduleFileSave();
            return;
        }
        this._isFileSaving = true;
        try {
            if ((await this.fileHandle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
                if ((await this.fileHandle.requestPermission({ mode: 'readwrite' })) !== 'granted') {
                    this.showToast('파일 쓰기 권한이 거부되었습니다.', 'error');
                    return;
                }
            }

            await this._writeAllToHandle(this.fileHandle);

            this.fileSaveTimer = null;
            this.showToast('연결된 파일에 저장되었습니다.');
        } catch (err) {
            console.error(err);
            this.showToast('파일 저장 중 오류가 발생했습니다.', 'error');
        } finally {
            this._isFileSaving = false;
        }
    },

    /* ── 새 파일로 저장 ── */
    async saveAsNewFile() {
        if (!window.showSaveFilePicker) { await this.downloadJSON(); return; }
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: 'novel_archive_data.json',
                types: [{ description: 'JSON Files', accept: { 'application/json': ['.json'] } }],
            });
            this.fileHandle = handle;

            await this._writeAllToHandle(handle);

            const file = await handle.getFile();
            this.updateFileButtonsState(true, file.name);
            this.showToast(`새 파일('${file.name}')에 저장 및 연결되었습니다.`);
        } catch (err) {
            if (err.name !== 'AbortError') console.error(err);
        }
    },

    updateFileButtonsState(isConnected, fileName = '') {
        const connectBtn = document.getElementById('connectFileBtn');
        const saveBtn = document.getElementById('saveFileBtn');
        if (!isConnected) return;
        if (connectBtn) {
            connectBtn.innerText = `📁 ${fileName}`;
            connectBtn.title = `연결된 파일: ${fileName} (클릭하여 다른 파일로 교체)`;
            connectBtn.style.maxWidth = '180px';
            connectBtn.style.overflow = 'hidden';
            connectBtn.style.textOverflow = 'ellipsis';
        }
        if (saveBtn) saveBtn.classList.remove('hidden');
    },

    async persistCurrentNovel() {
        if (!this.currentNovel) return;
        const idx = this.novels.findIndex(n => n.id === this.currentNovel.id);
        const prevKeyword = idx !== -1 ? this.novels[idx].keyword : '';
        const newMeta = await this.db.saveNovel(this.currentNovel);
        if (idx !== -1) this.novels[idx] = newMeta;
        else this.novels.push(newMeta);
        if (newMeta.keyword !== prevKeyword) this.rebuildTagCache();
        this.scheduleFileSave();
    },

    scheduleFileSave() {
        if (!this.fileHandle) return;
        if (this._isBackingUp) return;
        clearTimeout(this.fileSaveTimer);
        this.fileSaveTimer = setTimeout(() => this.saveToFile(), 60000);
    },

    /* ── 단일 파일 다운로드 ── */
    async downloadJSON() {
        const parts = ['[\n'];
        let first = true;
        for await (const json of this._iterNovelJson()) {
            parts.push((first ? '' : ',\n') + json);
            first = false;
        }
        parts.push('\n]');

        downloadBlob(
            new Blob(parts, { type: JSON_MIME }),
            `novel_archive_backup_${formatYmd(new Date(), '-')}.json`
        );
        this.showToast('JSON 백업 파일이 다운로드되었습니다.');
    }
};