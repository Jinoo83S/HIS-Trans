// ============================================================
// auth.js — 토큰/교사 정보 관리
// ============================================================

var Auth = (function() {
  var TOKEN_KEY   = 'his_token';
  var TEACHER_KEY = 'his_teacher';

  function getToken()   { return localStorage.getItem(TOKEN_KEY) || ''; }
  function getTeacher() {
    try { return JSON.parse(localStorage.getItem(TEACHER_KEY)) || null; }
    catch(e) { return null; }
  }
  function set(token, teacher) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(TEACHER_KEY, JSON.stringify(teacher));
  }
  function clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TEACHER_KEY);
  }
  function isLoggedIn() { return !!getToken() && !!getTeacher(); }

  return { getToken, getTeacher, set, clear, isLoggedIn };
})();
