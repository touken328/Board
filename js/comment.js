/* ============================================================
   COMMENT: 회차 덧글/답댓글 (마크다운 지원, 글자수 표시, 삭제/수정)
   ============================================================ */
const CommentMixin = {
    _commentOpenReplyId: null,     // 답글 작성 폼을 열어둔 부모 id
    _commentEditId: null,          // 수정 중인 댓글 id

    /* ── 댓글 영역 렌더 (회차 본문 아래) ── */
    renderChapterComments(novelId, chapterIdx, comments) {
        const roots = comments.filter(c => !c.parentId);
        const repliesOf = (pid) => comments.filter(c => c.parentId === pid);

        const commentHtml = (c, isReply) => `
            <div class="comment-item ${isReply ? 'comment-reply' : ''}" data-comment-id="${c.id}">
                ${
                    this._commentEditId === c.id
                        ? this._renderCommentEditForm(c)
                        : `<div class="markdown-render comment-body">${this.parseMarkdown(c.content || '')}</div>`
                }
                <div class="comment-head">
                    <span class="comment-meta">${this.formatDate(c.createdAt)}</span>
                    <span class="comment-charcount">${(c.content || '').length}자</span>
                    <div class="comment-actions">
                        ${!isReply ? `<button onclick="app.toggleCommentReply(${c.id})" class="chapter-nav-btn">↩ 답글</button>` : ''}
                        <button onclick="app.openCommentEdit(${c.id})" class="chapter-nav-btn">수정</button>
                        <button onclick="app.deleteComment(${c.id}, ${novelId}, ${chapterIdx})" class="chapter-nav-btn">삭제</button>
                    </div>
                </div>
                ${
                    this._commentOpenReplyId === c.id
                        ? this._renderCommentForm(novelId, chapterIdx, c.id, true)
                        : ''
                }
                ${repliesOf(c.id).map(r => commentHtml(r, true)).join('')}
            </div>
        `;

        return `
            <div class="panel comment-panel" id="chapterCommentPanel">
                <div class="comment-panel-header">
                    <h4 class="comment-panel-title">💬 덧글 (${comments.length})</h4>
                </div>
                <div class="comment-list">
                    ${roots.length ? roots.map(c => commentHtml(c, false)).join('') : '<div class="comment-empty">아직 덧글이 없습니다.</div>'}
                </div>
                ${this._renderCommentForm(novelId, chapterIdx, null, false)}
            </div>
        `;
    },

    _renderCommentForm(novelId, chapterIdx, parentId, isReply) {
        const label = isReply ? '↩ 답댓글 작성' : '✍️ 덧글 작성';
        return `
            <form class="comment-form ${isReply ? 'comment-form-reply' : ''}"
                  onsubmit="app.handleCommentSubmit(event, ${novelId}, ${chapterIdx}, ${parentId === null ? 'null' : parentId})">
                <div class="comment-form-head">
                    <span class="comment-form-label">${label}</span>
                    <div class="comment-form-tools">
                        <button type="button" class="purple-button" onclick="app.insertImageMarkdown('commentInput_${parentId ?? 'root'}')">🖼️ 이미지 url</button>
                        ${isReply ? `<button type="button" class="chapter-nav-btn" onclick="app.toggleCommentReply(${parentId})">취소</button>` : ''}
                    </div>
                </div>
                <textarea id="commentInput_${parentId ?? 'root'}" class="textarea" rows="12"
                          placeholder="덧글을 입력하세요. 마크다운 사용 가능"
                          oninput="app._syncCommentCharCount(this)"></textarea>
                <div class="comment-form-footer">
                    <span class="comment-charcount" data-role="charcount">0자</span>
                    <button type="submit" class="btn btn-purple btn-sm">등록</button>
                </div>
            </form>
        `;
    },

    _renderCommentEditForm(c) {
        return `
            <form class="comment-form comment-form-edit" onsubmit="app.handleCommentEditSubmit(event, ${c.id})">
                <textarea id="commentEditInput_${c.id}" class="textarea" rows="12"
                          oninput="app._syncCommentCharCount(this)">${escapeHtml(c.content || '')}</textarea>
                <div class="comment-form-footer">
                    <span class="comment-charcount" data-role="charcount">${(c.content || '').length}자</span>
                    <div class="comment-form-tools">
                        <button type="button" class="chapter-nav-btn" onclick="app.cancelCommentEdit()">취소</button>
                        <button type="submit" class="btn btn-purple btn-sm">저장</button>
                    </div>
                </div>
            </form>
        `;
    },

    _syncCommentCharCount(textarea) {
        const wrap = textarea.closest('.comment-form');
        if (!wrap) return;
        const label = wrap.querySelector('[data-role="charcount"]');
        if (label) label.textContent = `${(textarea.value || '').length}자`;
    },

    /* ── 댓글 패널만 비동기 갱신 ── */
    async refreshChapterComments() {
    // 상세 화면이 아니거나 chapters 탭이 아니면 스킵
    if (this.currentView !== 'detail' || this.activeDetailTab !== 'chapters') return;
    const panel = document.getElementById('chapterCommentPanel');
    if (!panel || !this.currentNovel) return;

    const novelId = this.currentNovel.id;
    const chapterIdx = this.selectedChapterIndex;
    try {
        const comments = await this.db.getCommentsByChapter(novelId, chapterIdx);
        // ★ outerHTML 교체 후 새 패널이 DOM 에 확실히 반영됨
        panel.outerHTML = this.renderChapterComments(novelId, chapterIdx, comments);
        this._updateChapterCommentBadge(chapterIdx, comments.length);
    } catch (e) {
        console.error('[comment] 로드 실패:', e);
        // ★ 실패해도 최소한 폼은 뜨도록 fallback
        panel.outerHTML = this.renderChapterComments(novelId, chapterIdx, []);
    }
},

    /* 댓글 수를 chapterMetas 에 기록 + 사이드바 배지 DOM 갱신 */
    _updateChapterCommentBadge(chapterIdx, count) {
        const meta = this.currentNovel?.chapterMetas?.[chapterIdx];
        if (meta) meta.commentCount = count;
        const btn = document.querySelector(`[data-chapter-btn][data-idx="${chapterIdx}"]`);
        if (!btn) return;
        let badge = btn.querySelector('.comment-badge');
        if (count > 0) {
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'comment-badge';
                btn.appendChild(badge);
            }
            badge.textContent = `(${count})`;
        } else if (badge) {
            badge.remove();
        }
    },

    /* ── submit / edit / delete ── */
    async handleCommentSubmit(event, novelId, chapterIdx, parentId) {
    event.preventDefault();
    // ★ event.target(폼) 안의 textarea 를 직접 찾음
    const form = event.target;
    const ta = form.querySelector('textarea');
    if (!ta) {
        console.warn('[comment] textarea 없음');
        return;
    }
    const content = (ta.value || '').trim();
    if (!content) { this.showToast('덧글 내용을 입력하세요.', 'error'); return; }

    // parentId 정규화
    let pid = null;
    if (parentId !== null && parentId !== undefined && parentId !== '') {
        const n = parseInt(parentId, 10);
        pid = Number.isInteger(n) ? n : null;
    }

    try {
        await this.db.addComment(novelId, chapterIdx, { content, parentId: pid });
        this._commentOpenReplyId = null;
        this.showToast(pid ? '답댓글이 등록되었습니다.' : '덧글이 등록되었습니다.');
        await this.refreshChapterComments();
        this._updateListCommentBadge(novelId, +1);
    } catch (e) {
        console.error('[comment] 등록 실패:', e);
        this.showToast('덧글 등록 실패: ' + (e.message || '알 수 없는 오류'), 'error');
    }
},

    async handleCommentEditSubmit(event, id) {
        event.preventDefault();
        const ta = document.getElementById(`commentEditInput_${id}`);
        if (!ta) return;
        await this.db.updateComment(id, (ta.value || '').trim());
        this._commentEditId = null;
        this.showToast('덧글이 수정되었습니다.');
        await this.refreshChapterComments();
    },

    async deleteComment(id, novelId, chapterIdx) {
        if (!confirm('이 덧글을 삭제할까요? (답댓글도 함께 삭제됩니다)')) return;
        // 삭제할 댓글 + 그 답댓글 수 파악 (뱃지 갱신용)
        const all = await this.db.getCommentsByChapter(novelId, chapterIdx);
        const target = all.find(c => c.id === id);
        let removed = 1;
        if (target && !target.parentId) {
            removed += all.filter(c => c.parentId === id).length;
        }
        await this.db.deleteComment(id);
        this.showToast('덧글이 삭제되었습니다.');
        await this.refreshChapterComments();
        this._updateListCommentBadge(novelId, -removed);
    },

    toggleCommentReply(commentId) {
        this._commentOpenReplyId = this._commentOpenReplyId === commentId ? null : commentId;
        this.refreshChapterComments();
    },

    openCommentEdit(commentId) {
        this._commentEditId = commentId;
        this.refreshChapterComments();
    },
    cancelCommentEdit() {
        this._commentEditId = null;
        this.refreshChapterComments();
    },

    /* 리스트뷰 novels[] 의 commentCount 캐시 동기화 */
    _updateListCommentBadge(novelId, delta) {
        const meta = this.novels.find(n => n.id === novelId);
        if (meta) meta.commentCount = Math.max(0, (meta.commentCount || 0) + delta);
    },
};