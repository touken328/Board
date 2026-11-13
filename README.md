js
  ├── constants.js       // 색상 팔레트, 정렬 comparator, 폰트 로더
  ├── utils.js           // escapeHtml, applyTextCorrections, 템플릿 헬퍼, 자동변환
  ├── db.js              // NovelDatabase 클래스
  ├── list-view.js       // 목록 화면 (render/검색/정렬/배치태그/JSON)
  ├── detail-view.js     // 상세 화면 (탭, 회차/설정 렌더링, 부분 갱신)
  ├── chapter-edit.js    // 회차 추가/수정/삭제, 자동저장, 변환/검색
  ├── setting-edit.js    // 설정 추가/수정/삭제
  ├── modal.js           // 모달 공통, 새 작품 등록, 작품 정보 수정
  ├── file-sync.js       // 파일 연결/저장/JSON 백업
  ├── preferences.js     // 테마, 폰트/크기/줄간격, 키 이벤트, 토스트
  └── app.js             // 부트스트랩 (모든 메서드 병합 + 인스턴스 생성)
