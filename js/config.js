// ============================================================
// config.js — GAS Web App URL 관리
// ============================================================
//
// 운영 배포: 아래 FIXED_GAS_URL에 배포된 GAS 웹앱 URL을 입력하세요.
//   예) var FIXED_GAS_URL = 'https://script.google.com/macros/s/AKfy.../exec';
// 이 값이 설정되면 사용자가 URL을 변경할 수 없습니다(보안).
//
// 개발 중: FIXED_GAS_URL을 빈 문자열('')로 두면
//   기존처럼 사용자가 🔗 URL 버튼으로 입력/변경할 수 있습니다.
// ============================================================

var FIXED_GAS_URL = '';  // ← 운영 시 여기에 GAS URL 입력

var Config = (function() {
  var KEY = 'his_gas_url';

  function get() {
    // 고정 URL이 있으면 항상 그것을 사용 (localStorage 무시)
    if (FIXED_GAS_URL) return FIXED_GAS_URL;
    return localStorage.getItem(KEY) || '';
  }

  function set(url) {
    // 고정 URL 모드에서는 변경 불가
    if (FIXED_GAS_URL) return;
    localStorage.setItem(KEY, url.split('?')[0]);
  }

  function clear() {
    if (FIXED_GAS_URL) return;
    localStorage.removeItem(KEY);
  }

  function isSet() {
    return !!get();
  }

  // 고정 URL 모드 여부 (UI에서 URL 변경 버튼 숨김용)
  function isLocked() {
    return !!FIXED_GAS_URL;
  }

  return { get, set, clear, isSet, isLocked };
})();
