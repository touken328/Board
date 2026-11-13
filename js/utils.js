/* ============================================================
   TEXT CORRECTION / ESCAPE / TEMPLATE HELPERS
   ============================================================ */
function applyTextCorrections(text) {
    if (!text) return '';
    let converted = text;

    let openDouble = false;
    converted = converted.replace(/"/g, () => (openDouble = !openDouble) ? '“' : '”');

    let openSingle = false;
    converted = converted.replace(/'/g, () => (openSingle = !openSingle) ? '‘' : '’');

    converted = converted.replace(/\.{3,}/g, '……');
    converted = converted.replace(/···/g, '……');
    converted = converted.replace(/　“/g, '“');
    converted = converted.replace(/　‘/g, '‘');
    converted = converted.replace(/떄/g, '때');
    converted = converted.replace(/겟지/g, '겠지');
    converted = converted.replace(/겟어/g, '겠어');
    converted = converted.replace(/(…)([”’])/g, '$1.$2');
    converted = converted.replace(/([다어데지])([”])/g, '$1.$2');

    return converted;
}

const HTML_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, c => HTML_MAP[c]);
}

function renderColorGrid(name, selectedHex = '') {
    const sel = (selectedHex || '').toLowerCase();
    return COLOR_PALETTE.map(c => `
        <label class="color-opt">
            <input type="radio" name="${name}" value="${c.hex}" ${c.hex.toLowerCase() === sel ? 'checked' : ''}>
            <span class="color-dot" style="background-color:${c.hex};"></span>
            <span class="color-name">${c.name}</span>
        </label>
    `).join('');
}

function autoCorrectBlock(textareaId, uploadHandler) {
    return `
        <div style="display:flex; gap:0.5rem;">
            <button type="button" onclick="app.triggerAutoCorrect('${textareaId}')" class="gold-button">✨ 자동 변환</button>
            <label class="cyan-button" style="cursor:pointer;">
                텍스트 업로드
                <input type="file" accept=".txt" onchange="app.${uploadHandler}(event)" hidden>
            </label>
        </div>
    `;
}

function computeHasRichSettings(settings) {
    if (!Array.isArray(settings) || settings.length === 0) return false;
    const byteLength = (s) => new TextEncoder().encode(s || '').length;
    const total = settings.reduce((a, s) => a + byteLength(s.content), 0);
    return total >= RICH_SETTINGS_THRESHOLD;
}
/* ============================================================
   STREAM JSON ARRAY
   - 파일 전체를 텍스트로 읽어 JSON.parse 후 배열 원소를 순차 yield
   - 청크 스트리밍 파서의 상태 관리 버그를 피하기 위해 단순/안전 구현
   - 배열이 아닌 단일 객체도 허용 (배열로 감싸서 처리)
   ============================================================ */
async function streamJsonArray(file, onItem, options = {}) {
    const { signal = null } = options;

    if (signal && signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
    }

    let text;
    try {
        text = await file.text();
    } catch (e) {
        throw new Error(`파일을 읽지 못했습니다: ${e.message}`);
    }

    if (signal && signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
    }

    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch (e) {
        throw new Error(`JSON 파싱 실패: ${e.message}`);
    }

    // 배열이면 그대로, 단일 객체면 배열로 감싸기
    let list;
    if (Array.isArray(parsed)) {
        list = parsed;
    } else if (parsed && typeof parsed === 'object') {
        list = [parsed];
    } else {
        throw new Error('JSON 최상위가 배열도 객체도 아닙니다.');
    }

    for (let i = 0; i < list.length; i++) {
        if (signal && signal.aborted) {
            throw new DOMException('Aborted', 'AbortError');
        }
        await onItem(list[i]);
        // 주기적으로 이벤트 루프 양보 (UI 멈춤 방지)
        if (i % 32 === 0) {
            await new Promise(r => setTimeout(r, 0));
        }
    }
}