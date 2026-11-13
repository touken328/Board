/* ============================================================
   FILE SYNC: 파일 연결/저장, JSON 백업/복원
   ============================================================ */
const FileSyncMixin = {
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
            const BATCH = 5;
            let pending = [];
            let saved = 0;

            const flush = async () => {
                if (!pending.length) return;
                await this.db._putNovelsChunk(pending);
                saved += pending.length;
                pending = [];
                ctrl.update({ done: saved, total: Math.max(saved, 0), phase: 'save' });
                await new Promise(r => setTimeout(r, 0));
            };

            await this.db._clearAllStores();
            await streamJsonArray(file, async (item) => {
                pending.push(item);
                if (pending.length >= BATCH) await flush();
            }, { signal: ctrl.signal });
            await flush();

            ctrl.close();
            this.novels = await this.db.getAllMetas();
            this.rebuildTagCache();
            this.render();
            this.updateGlobalStats();
            this.updateFileButtonsState(true, file.name);
            this.showToast(`'${file.name}' 파일이 연결 및 로드되었습니다. (${saved}개)`);
        } catch (err) {
            this._restoreProgressEl?.remove();
            this._restoreProgressEl = null;
            if (err.name !== 'AbortError') {
                console.error(err);
                this.showToast(`파일 연결 실패: ${err.message}`, 'error');
            }
        }
    },

    /* ────────────────────────────────────────────────────────────
       ★ 스트리밍 백업 (분할 다운로드)
       - 작품 하나씩 로드 → 직렬화 → 그룹 버퍼에 append
       - 그룹 버퍼가 5MB 를 넘으면 즉시 Blob 생성 후 버퍼 해제
       - snapshots 배열에 전 작품을 들고 있지 않음 (메모리 절반 이하)
       ──────────────────────────────────────────────────────────── */
    async downloadJSONSplit() {
        if (this._isBackingUp) {
            this.showToast('이미 백업이 진행 중입니다.', 'error');
            return;
        }
        this._isBackingUp = true;

        try {
            if (typeof this.flushAutoSave === 'function') {
                await this.flushAutoSave();
            }

            const TARGET_BYTES = 5 * 1024 * 1024;
            const utf8Bytes = (s) => new TextEncoder().encode(s).length;

            const metas = await this.db.getAllMetas();
            if (metas.length === 0) {
                this.showToast('백업할 데이터가 없습니다.', 'error');
                return;
            }

            // 파일명/날짜
            const d = new Date();
            const pad = (n) => String(n).padStart(2, '0');
            const dateStr = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;

            // 그룹 버퍼: [{ serialized, bytes }], 전체 byte 합
            // 그룹이 확정되면 즉시 파일로 내보내고 이 배열은 비운다.
            let groupBuf = [];
            let groupBytes = 2;                 // '[' + ']'
            let partIndex = 0;
            let totalNovelsSaved = 0;
            const SEP_BYTES = 2;                // 작품 사이 `,` + 개행 여유치

            // 파일 하나를 즉시 다운로드 (그룹 버퍼가 확정될 때마다 호출)
            const flushGroupAsFile = async () => {
                if (groupBuf.length === 0) return;
                partIndex++;
                const chunkJson = '[' + groupBuf.map(s => s.serialized).join(',\n') + ']';
                // Blob 생성 직후 groupBuf를 비워 메모리 해제 유도
                const blob = new Blob([chunkJson], { type: 'application/json;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                // 파일명은 "partNofM" 형태를 유지할 수 없으므로 잠정 이름으로 다운로드
                // (전체 part 수는 그룹 확정 시점에 알 수 없음 → 뒤에서 rename 불가)
                // → "partN" 형식으로 저장. 파일 순서는 다운로드 순서와 동일.
                a.download = `novel_archive_${dateStr}_part${partIndex}.json`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);

                groupBuf = [];
                groupBytes = 2;
                await new Promise(r => setTimeout(r, 300));
            };

            this.showToast('분할 다운로드를 시작합니다...');

            // 작품 하나씩 처리
            for (let i = 0; i < metas.length; i++) {
                const m = metas[i];
                // ★ 작품 전체 로드 (이 시점에만 해당 작품 본문이 메모리 상주)
                const novel = await this.db.getNovelById(m.id);
                if (!novel) continue;

                const serialized = JSON.stringify(novel, null, 2);
                const bytes = utf8Bytes(serialized);

                // 작품 하나가 목표보다 크면: 혼자 한 파일로
                if (bytes > TARGET_BYTES) {
                    // 현재 그룹을 먼저 확정
                    await flushGroupAsFile();
                    // 이 작품만 단독 파일
                    groupBuf = [{ serialized, bytes }];
                    groupBytes = bytes + 2;
                    await flushGroupAsFile();
                    totalNovelsSaved++;
                    continue;
                }

                // 새 작품을 넣었을 때 목표를 넘으면 그룹 확정
                const nextBytes = groupBytes + bytes + (groupBuf.length ? SEP_BYTES : 0);
                if (groupBuf.length && nextBytes > TARGET_BYTES) {
                    await flushGroupAsFile();
                }
                groupBuf.push({ serialized, bytes });
                groupBytes += bytes + (groupBuf.length > 1 ? SEP_BYTES : 0);
                totalNovelsSaved++;
            }

            // 마지막 그룹 확정
            await flushGroupAsFile();

            this.showToast(`분할 백업 완료 (${partIndex}개 파일, ${totalNovelsSaved}개 작품)`);
        } catch (err) {
            console.error(err);
            this.showToast('분할 다운로드 중 오류가 발생했습니다.', 'error');
        } finally {
            this._isBackingUp = false;
        }
    },

    /* ────────────────────────────────────────────────────────────
       ★ 스트리밍 복원 (다중 파일)
       - 파일을 하나씩 streamJsonArray 로 파싱 → 5개 배치로 DB 저장
       - allParsedData 병합 없음 (파일 1개 단위로 상주)
       ──────────────────────────────────────────────────────────── */
    async restoreMultipleJSON(event) {
        const files = Array.from(event.target.files);
        if (files.length === 0) return;
        event.target.value = '';

        if (!confirm(`총 ${files.length}개의 파일을 복원하시겠습니까?\n현재 데이터는 모두 덮어씌워집니다.`)) {
            return;
        }

        const ctrl = this._showRestoreProgress();
        const BATCH = 5;
        let pending = [];
        let savedTotal = 0;

        // 배치 저장 헬퍼
        const flush = async () => {
            if (!pending.length) return;
            if (ctrl.signal.aborted) throw new DOMException('Aborted', 'AbortError');
            await this.db._putNovelsChunk(pending);
            savedTotal += pending.length;
            pending = [];
            ctrl.update({ done: savedTotal, total: Math.max(savedTotal, 1), phase: 'save' });
            await new Promise(r => setTimeout(r, 0));
        };

        try {
            // 기존 데이터 초기화
            ctrl.update({ done: 0, total: files.length, phase: 'clear' });
            await this.db._clearAllStores();

            // 파일별 스트리밍
            for (let i = 0; i < files.length; i++) {
                if (ctrl.signal.aborted) throw new DOMException('Aborted', 'AbortError');
                const file = files[i];
                ctrl.update({ done: i, total: files.length, phase: 'read' });

                await streamJsonArray(file, async (item) => {
                    pending.push(item);
                    if (pending.length >= BATCH) await flush();
                }, { signal: ctrl.signal });

                // 파일 경계에서 남은 배치 flush
                await flush();
            }

            if (savedTotal === 0) {
                throw new Error('유효한 데이터가 없습니다.');
            }

            ctrl.close();
            this.novels = await this.db.getAllMetas();
            this.rebuildTagCache();
            this.showToast(`성공적으로 복원되었습니다. (${savedTotal}개 작품)`);
            this.render();
            this.updateGlobalStats();
        } catch (err) {
            this._restoreProgressEl?.remove();
            this._restoreProgressEl = null;
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

        overlay.querySelector('#restoreCancelBtn').addEventListener('click', () => {
            controller.abort();
        });

        const PHASE_LABELS = {
            read:  (done, total) => `파일 읽는 중… (${done + 1} / ${total})`,
            clear: () => '기존 데이터 초기화 중…',
            save:  (done, total) => `DB에 저장 중… (${done} / ${total})`,
            done:  () => '완료',
        };

        const update = ({ done, total, phase: ph }) => {
            const ratio = total > 0 ? done / total : 0;
            const p = Math.min(100, Math.round(ratio * 100));
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

    /* ────────────────────────────────────────────────────────────
       ★ 연결 파일 저장 (File System Access)
       - 전체 문자열 한 번에 write 하지 않고, 작품 단위로 writable.write() 청크 조립
       - JSON 배열을 수동 조립: '[\n' + 항목들(`,`) + '\n]'
       - 원자성: writable 은 마지막 close 시점에 반영됨
       ──────────────────────────────────────────────────────────── */
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
            if (typeof this._setSaveStatus === 'function') this._setSaveStatus('saving', '파일 저장 중…');

            const metas = await this.db.getAllMetas();
            const writable = await this.fileHandle.createWritable();

            // JSON 배열 수동 조립
            await writable.write('[\n');
            for (let i = 0; i < metas.length; i++) {
                const novel = await this.db.getNovelById(metas[i].id);
                if (!novel) continue;
                const json = JSON.stringify(novel, null, 2);
                // 각 항목 앞에 쉼표(첫 항목 제외)
                await writable.write((i > 0 ? ',\n' : '') + json);
            }
            await writable.write('\n]');
            await writable.close();

            this.fileSaveTimer = null;
            if (typeof this._setSaveStatus === 'function') this._setSaveStatus('saved', '파일 저장됨');
            this.showToast('연결된 파일에 저장되었습니다.');
        } catch (err) {
            console.error(err);
            if (typeof this._setSaveStatus === 'function') this._setSaveStatus('error', '파일 저장 실패');
            this.showToast('파일 저장 중 오류가 발생했습니다.', 'error');
        } finally {
            this._isFileSaving = false;
        }
    },

    /* ★ 전체 로드 (호환용 유지)
       - saveToFile / downloadJSONSplit 은 더 이상 이 메서드를 쓰지 않는다.
       - 외부에서 호출할 가능성이 있으므로 남겨둔다. */
    async loadAllFullNovels() {
        const metas = await this.db.getAllMetas();
        return Promise.all(metas.map(async m => {
            const c = await this.db.getContent(m.id);
            return { ...m, chapters: c.chapters || [], settings: c.settings || [] };
        }));
    },

    /* ────────────────────────────────────────────────────────────
       ★ 새 파일로 저장 (saveAsNewFile) — saveToFile 과 동일한 스트리밍 방식
       ──────────────────────────────────────────────────────────── */
    async saveAsNewFile() {
        if (!window.showSaveFilePicker) { await this.downloadJSON(); return; }
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: 'novel_archive_data.json',
                types: [{ description: 'JSON Files', accept: { 'application/json': ['.json'] } }],
            });
            this.fileHandle = handle;

            const metas = await this.db.getAllMetas();
            const writable = await handle.createWritable();
            await writable.write('[\n');
            for (let i = 0; i < metas.length; i++) {
                const novel = await this.db.getNovelById(metas[i].id);
                if (!novel) continue;
                const json = JSON.stringify(novel, null, 2);
                await writable.write((i > 0 ? ',\n' : '') + json);
            }
            await writable.write('\n]');
            await writable.close();

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

    /* ────────────────────────────────────────────────────────────
       ★ 단일 파일 다운로드
       - 작품 단위 Blob 조립: 각 작품을 BlobPart 로 추가
       - 전체 문자열 concat 없음 (Blob 생성이 내부적으로 스트리밍 처리)
       ──────────────────────────────────────────────────────────── */
    async downloadJSON() {
        const metas = await this.db.getAllMetas();
        const parts = [];
        parts.push('[\n');
        let first = true;
        for (let i = 0; i < metas.length; i++) {
            const novel = await this.db.getNovelById(metas[i].id);
            if (!novel) continue;
            const json = JSON.stringify(novel, null, 2);
            parts.push((first ? '' : ',\n') + json);
            first = false;
        }
        parts.push('\n]');

        const blob = new Blob(parts, { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const d = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        a.download = `novel_archive_backup_${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        this.showToast('JSON 백업 파일이 다운로드되었습니다.');
    },

    /* ────────────────────────────────────────────────────────────
       ★ 단일 파일 복원 (input type=file onchange)
       - FileReader 로 전체 텍스트 로드 대신 파일 스트리밍 사용
       - streamJsonArray 로 배치 저장
       ──────────────────────────────────────────────────────────── */
    restoreJSON(event) {
        const file = event.target.files[0];
        if (!file) return;
        event.target.value = '';

        const run = async () => {
            try {
                if (!confirm(`'${file.name}' 파일을 복원하시겠습니까?\n현재 데이터는 모두 덮어씌워집니다.`)) {
                    return;
                }

                const ctrl = this._showRestoreProgress();
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
                    await new Promise(r => setTimeout(r, 0));
                };

                ctrl.update({ done: 0, total: 1, phase: 'clear' });
                await this.db._clearAllStores();

                await streamJsonArray(file, async (item) => {
                    pending.push(item);
                    if (pending.length >= BATCH) await flush();
                }, { signal: ctrl.signal });
                await flush();

                ctrl.close();
                this.novels = await this.db.getAllMetas();
                this.rebuildTagCache();
                this.showToast(`성공적으로 복원되었습니다. (${saved}개 작품)`);
                this.render();
                this.updateGlobalStats();
            } catch (err) {
                if (err.name === 'AbortError') {
                    this.showToast('복원이 취소되었습니다.', 'error');
                } else {
                    console.error(err);
                    this.showToast(`복원 실패: ${err.message || '알 수 없는 오류'}`, 'error');
                }
            } finally {
                this._restoreProgressEl?.remove();
                this._restoreProgressEl = null;
            }
        };
        run();
    }
};