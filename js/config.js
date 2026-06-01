// ============================================================
// config.js — GAS Web App URL 관리
// ============================================================

var Config = (function() {
  var KEY = 'his_gas_url';

  function get() {
    return localStorage.getItem(KEY) || '';
  }

  function set(url) {
    localStorage.setItem(KEY, url.split('?')[0]);
  }

  function clear() {
    localStorage.removeItem(KEY);
  }

  function isSet() {
    return !!get();
  }

  return { get, set, clear, isSet };
})();
