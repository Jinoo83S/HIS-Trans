// ============================================================
// app.js — 메인 앱 로직
// ============================================================

var APP = {
  teacher: null,
  currentTab: '과목',
  currentView: 'translate',
  subjects: [],
  selectedSubject: null,
  rows: [],
  prompt: '',
  models: {
    gpt:    ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    claude: ['claude-opus-4-8', 'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
    gemini: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
    google: ['google-translate']
  },
  // 캐시
  cache: {
    loaded:    false,
    courseMap: {},
    clubMap:   {},
    transMap:  {}
  },
  settings: null,  // 엔진/프롬프트/용어/예시
  progressCancelled: false
};

// ── 초기화 ──────────────────────────────────────────────────
window.onload = async function() {
  if (!Config.isSet()) { window.location.href = 'index.html'; return; }
  if (!Auth.isLoggedIn()) { window.location.href = 'index.html'; return; }

  try {
    var res = await API.getMe();
    if (!res) { window.location.href = 'index.html'; return; }
    if (res.error === 'unauthorized') {
      // 진짜 인증 오류만 clear
      Auth.clear();
      window.location.href = 'index.html';
      return;
    }
    if (res.success && res.data) {
      APP.teacher = res.data;
      Auth.set(Auth.getToken(), res.data); // 최신 교사 정보 갱신
    } else {
      // 기타 오류 → 캐시 사용
      APP.teacher = Auth.getTeacher();
    }
    if (!APP.teacher) { window.location.href = 'index.html'; return; }
    initUI();
  } catch(e) {
    // 네트워크 오류 → 캐시된 정보로 진행
    APP.teacher = Auth.getTeacher();
    if (!APP.teacher) { window.location.href = 'index.html'; return; }
    initUI();
  }
};

function relayout() {
  var header  = document.getElementById('header');
  var toolbar = document.getElementById('toolbar');
  var tabs    = document.getElementById('tabs');
  var main    = document.getElementById('main');
  if (!header || !main) return;

  var hH = header.offsetHeight;
  var tbH = (toolbar && toolbar.style.display !== 'none') ? toolbar.offsetHeight : 0;
  var tabH = (tabs && tabs.style.display !== 'none') ? tabs.offsetHeight : 0;

  // toolbar / tabs 위치 고정 재배치
  if (toolbar) toolbar.style.top = hH + 'px';
  if (tabs)    tabs.style.top    = (hH + tbH) + 'px';
  main.style.top = (hH + tbH + tabH) + 'px';
}

window.addEventListener('resize', relayout);

function initUI() {
  var t = APP.teacher;
  var nameLabel = t.name + ' / ' + t.fullName;
  // 검수 교사면 담당 번역 교사 표시
  if (t.role === '검수' && t.assignedTo) {
    nameLabel += ' (검수 담당: ' + t.assignedTo + ')';
  }
  document.getElementById('tName').textContent = nameLabel;
  var rb = document.getElementById('rBadge');
  rb.textContent = t.role;
  rb.className = 'role-badge role-' + t.role;

  // GAS URL 고정 모드면 URL 변경 버튼 숨김
  if (Config.isLocked && Config.isLocked()) {
    var btnUrl = document.getElementById('btnUrl');
    if (btnUrl) btnUrl.style.display = 'none';
  }

  // 권한별 탭 표시
  var role = t.role;
  var canInput     = (role === '번역' || role === '관리자');
  var canTranslate = (role === '검수' || role === '관리자');
  if (canInput)     document.getElementById('navInput').style.display = '';
  if (canTranslate) document.getElementById('navTranslate').style.display = '';
  if (role === '관리자') document.getElementById('navAdmin').style.display = '';

  // 학년도 옵션
  var now = new Date(), curY = now.getFullYear();
  var ys = document.getElementById('selYear');
  for (var y = curY; y >= curY - 3; y--) {
    var o = document.createElement('option');
    o.value = o.textContent = y; ys.appendChild(o);
  }
  document.getElementById('selSem').value = (now.getMonth() + 1) <= 7 ? '1' : '2';

  // 기본 뷰 결정
  var defaultView = canInput ? 'input' : (canTranslate ? 'translate' : 'admin');
  APP.currentView = defaultView;

  // 설정 로드 후 초기 데이터
  loadSettings(function() {
    onEngineChange();
    applyDefaultView(defaultView);
    loadInitialData();
    setTimeout(relayout, 100);
  });
}

function applyDefaultView(view) {
  document.querySelectorAll('.nav-btn').forEach(function(b) {
    b.classList.toggle('active', b.dataset.view === view);
  });
  document.getElementById('vInput').style.display     = view === 'input'     ? '' : 'none';
  document.getElementById('vTranslate').style.display = view === 'translate' ? '' : 'none';
  document.getElementById('vAdmin').style.display     = view === 'admin'     ? '' : 'none';
  var isAdmin = view === 'admin';
  toggleToolbarMode(isAdmin);
  document.getElementById('tabs').style.display = isAdmin ? 'none' : '';
  if (view === 'admin') renderAdminTab();
  setTimeout(relayout, 0);
}

// 관리 탭: 번역 전용 컨트롤 숨김, 엔진 컨트롤만 표시
function toggleToolbarMode(isAdminView) {
  document.querySelectorAll('.trans-only').forEach(function(el) {
    el.style.display = isAdminView ? 'none' : '';
  });
  // 관리자는 관리 탭에서 엔진 컨트롤 편집 가능, 그 외엔 읽기전용
  var canEdit = APP.teacher.role === '관리자';
  ['selEngine','selModel','slCreat'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.disabled = !canEdit;
  });
}

// 설정 로드 (엔진/프롬프트/용어/예시)
function loadSettings(cb) {
  API.getSettings().then(function(res) {
    if (res && res.success) {
      APP.settings = res.data;
      mergeCustomModels(res.data.customModels);
      // 엔진/모델/creativity 기본값 적용
      var eng = document.getElementById('selEngine');
      var mdl = document.getElementById('selModel');
      var crt = document.getElementById('slCreat');
      if (eng) eng.value = res.data.engine || 'claude';
      onEngineChange();
      if (mdl) mdl.value = res.data.model || 'claude-opus-4-8';
      if (crt) { crt.value = res.data.creativity || '0.3';
        var vc = document.getElementById('vCreat'); if (vc) vc.textContent = crt.value; }
      // 엔진 설정: 관리자 외 비활성화 (읽기전용 표시)
      var isAdmin = APP.teacher.role === '관리자';
      [eng, mdl, crt].forEach(function(el) { if (el) el.disabled = !isAdmin; });
    }
    if (cb) cb();
  }).catch(function() { if (cb) cb(); });
}

// ── 과목 목록 ────────────────────────────────────────────────
async function loadSubjects() {
  await loadInitialData();
}

async function loadInitialData(force) {
  var year = document.getElementById('selYear').value;
  var sem  = document.getElementById('selSem').value;

  // 이미 로드됐고 강제 갱신 아니면 스킵
  if (APP.cache.loaded && !force) {
    renderSubjectSelect();
    return;
  }

  showLoading('데이터 불러오는 중...');
  try {
    var res = await API.getInitialData(year, sem);
    hideLoading();
    if (!res.success) { toast('로드 실패: ' + res.error, 'error'); return; }

    // 캐시 저장
    APP.subjects        = res.subjects  || [];
    APP.cache.courseMap = res.courseMap || {};
    APP.cache.clubMap   = res.clubMap   || {};
    APP.cache.transMap  = res.transMap  || {};
    APP.cache.loaded    = true;

    renderSubjectSelect();
    updateTransBadge();
    toast('데이터 로드 완료 ✓', 'success');
  } catch(e) { hideLoading(); toast('오류: ' + e.message, 'error'); }
}

function renderSubjectSelect() {

  var sel = document.getElementById('selSubject');
  var grade = document.getElementById('selGrade').value;
  var tab = APP.currentTab;

  var filtered = APP.subjects.filter(s =>
    s.type === tab && (!grade || String(s.grade) === grade)
  );

  var isAdmin = APP.teacher && APP.teacher.role === '관리자';

  // 과목별 번역 대기 건수 접두사 (과목명 앞)
  function pendingPrefix(subjectCode) {
    var n = countPendingBySubject(subjectCode);
    return n > 0 ? '🔴' + n + ' ' : '';
  }

  // 관리자: 교사명 기준 정렬, 동일 교사면 학년 순
  if (isAdmin) {
    filtered.sort(function(a, b) {
      var ta = (a.teachers && a.teachers[0]) || '';
      var tb = (b.teachers && b.teachers[0]) || '';
      if (ta !== tb) return ta.localeCompare(tb, 'ko');
      // 같은 교사 내에서는 학년 순
      return Number(a.grade) - Number(b.grade);
    });
  }

  // 관리자: 교사별 구분선(optgroup) 적용
  if (isAdmin) {
    var groups = {};
    var groupOrder = [];
    filtered.forEach(function(s) {
      var teacher = (s.teachers && s.teachers[0]) || '(미배정)';
      if (!groups[teacher]) { groups[teacher] = []; groupOrder.push(teacher); }
      groups[teacher].push(s);
    });
    // 각 교사 그룹 내 학년 순 정렬
    groupOrder.forEach(function(t) {
      groups[t].sort(function(a, b) { return Number(a.grade) - Number(b.grade); });
    });

    sel.innerHTML = '<option value="">-- ' +
      (tab === '과목' ? '과목 선택' : '동아리 선택') + ' --</option>' +
      groupOrder.map(function(teacher) {
        var opts = groups[teacher].map(function(s) {
          var allTeachers = s.teachers && s.teachers.length > 1
            ? ' [' + s.teachers.join(', ') + ']' : '';
          var gradePrefix = tab === '과목' ? 'G' + s.grade + ' | ' : '';
          return `<option value="${s.subjectCode}" data-s='${JSON.stringify(s)}'>` +
            `${pendingPrefix(s.subjectCode)}${gradePrefix}${s.nameKR}${allTeachers}</option>`;
        }).join('');
        return `<optgroup label="👤 ${teacher}">${opts}</optgroup>`;
      }).join('');
  } else {
    sel.innerHTML = '<option value="">-- ' +
      (tab === '과목' ? '과목 선택' : '동아리 선택') + ' --</option>' +
      filtered.map(function(s) {
        return `<option value="${s.subjectCode}" data-s='${JSON.stringify(s)}'>` +
          `${pendingPrefix(s.subjectCode)}${s.nameKR} / ${s.nameEN}</option>`;
      }).join('');
  }
}

// 특정 과목의 번역 대기 건수 (원문 있고 최종본 없음)
function countPendingBySubject(subjectCode) {
  var code = String(subjectCode);

  // 현재 선택된 과목이면 화면 데이터(APP.rows)로 정확히 계산
  if (APP.selectedSubject && String(APP.selectedSubject.subjectCode) === code && APP.rows.length) {
    var c = 0;
    APP.rows.forEach(function(r) {
      if (r.sourceText && String(r.sourceText).trim() && r.status !== 'reviewed') c++;
    });
    return c;
  }

  // 그 외 과목은 캐시 transMap으로 계산
  var tm = APP.cache.transMap || {};
  var n = 0;
  Object.keys(tm).forEach(function(key) {
    var sep = key.indexOf('|');
    if (sep === -1) return;
    if (key.substring(0, sep) !== code) return;
    var rec = tm[key];
    if (rec.sourceText && String(rec.sourceText).trim() && rec.status !== 'reviewed') n++;
  });
  return n;
}

// 드롭다운 대기 건수만 갱신 (현재 선택 유지)
function refreshSubjectDropdownCounts() {
  var sel = document.getElementById('selSubject');
  if (!sel) return;
  var cur = sel.value;
  renderSubjectSelect();
  sel.value = cur;
}

async function onSubjectChange() {
  var sel = document.getElementById('selSubject');
  var opt = sel.options[sel.selectedIndex];
  if (!opt || !opt.dataset.s) { APP.selectedSubject = null; showEmptyTrans(); return; }

  APP.selectedSubject = JSON.parse(opt.dataset.s);
  var isClub      = APP.currentTab === '동아리';
  var subjectCode = APP.selectedSubject.subjectCode;

  // 번역 탭: 캐시에서 즉시 로드
  var students = isClub
    ? (APP.cache.clubMap[subjectCode]   || [])
    : (APP.cache.courseMap[subjectCode] || []);

  if (!students.length && !APP.cache.loaded) {
    // 캐시 미준비 시 fallback: API 직접 호출
    showLoading('불러오는 중...');
    try {
      var [sRes, tRes] = await Promise.all([
        API.getStudentsByCourse(subjectCode, isClub, document.getElementById('selSem').value),
        API.getTransList({ year: document.getElementById('selYear').value,
                          semester: document.getElementById('selSem').value,
                          subjectCode: subjectCode })
      ]);
      hideLoading();
      if (!sRes.success) { toast('학생 로드 실패', 'error'); return; }
      students = sRes.data;
      var fm = {};
      (tRes.data || []).forEach(function(t) {
        if (!fm[t.studentName] || t.rowIndex > fm[t.studentName].rowIndex) fm[t.studentName] = t;
      });
      APP.rows = students.map(function(s) {
        var saved = fm[s.name] || {};
        return { student: s, sourceText: saved.sourceText||'',
          translatedDraft: saved.translatedDraft||'',
          finalText: saved.finalText||saved.reviewedText||'',
          comment: saved.reviewerComment||'', status: saved.status||'draft',
          rowIndex: saved.rowIndex||null, translating: false, _dirty: false };
      });
      renderCurrentView(); return;
    } catch(err) { hideLoading(); toast(err.message, 'error'); return; }
  }

  // 캐시 데이터로 즉시 렌더링
  APP.rows = students.map(function(s) {
    var key   = subjectCode + '|' + s.name;
    var saved = APP.cache.transMap[key] || {};
    return {
      student:         s,
      sourceText:      saved.sourceText      || '',
      translatedDraft: saved.translatedDraft || '',
      finalText:       saved.finalText       || saved.reviewedText || '',
      comment:         saved.reviewerComment || '',
      aiMemo:          saved.aiMemo          || '',
      status:          saved.status          || 'draft',
      rowIndex:        saved.rowIndex        || null,
      translating:     false,
      _dirty:          false
    };
  });
  renderCurrentView();
}

function onFilterChange() {
  APP.cache.loaded = false;
  _historyAll = null; // 연도/학기 변경 시 이력 전체 캐시 무효화
  loadSubjects();
}

// ── 입력 뷰 (외국인 교사: 원문만 입력) ────────────────────────
function renderInputTable() {
  var head  = document.getElementById('inputHead');
  var body  = document.getElementById('inputBody');
  var table = document.getElementById('inputTable');
  var empty = document.getElementById('emptyInput');

  if (!APP.rows.length) {
    table.style.display = 'none'; empty.style.display = 'block'; return;
  }
  table.style.display = ''; empty.style.display = 'none';

  // colgroup
  var cols = '<colgroup>' +
    '<col style="width:7%">' +   // Name EN
    '<col style="width:6%">' +   // 이름
    '<col style="width:3.5%">' + // Gr
    '<col style="width:3.5%">' + // Cls
    '<col style="width:5%">' +   // NEIS
    '<col style="width:64%">' +  // 원문 입력 (확대)
    '<col style="width:11%">' +  // 상태/저장
    '</colgroup>';
  var existing = table.querySelector('colgroup');
  if (existing) existing.remove();
  table.insertAdjacentHTML('afterbegin', cols);

  head.innerHTML = '<tr>' +
    '<th>Name (EN)</th><th>이름</th><th>Gr.</th><th>Cls.</th><th>NEIS</th>' +
    '<th class="ths">원문 입력 (Source)</th><th>저장</th></tr>';

  body.innerHTML = APP.rows.map(function(r, i) {
    var s = r.student;
    return '<tr id="irow_' + i + '">' +
      '<td><div class="ci" style="font-size:11px">' + e(s.engName||'-') + '</div></td>' +
      '<td><div class="ci" style="font-size:11px">' + e(s.name) + '</div></td>' +
      '<td><div class="ci">' + s.grade + '</div></td>' +
      '<td><div class="ci">' + s.class + '</div></td>' +
      '<td><div class="ci ci-neis">' + e(s.neis||s.neisClass||'') + '</div></td>' +
      '<td><textarea class="cta src" oninput="onInputSourceChange(' + i + ',this.value);autoResize(this)">' + e(r.sourceText) + '</textarea></td>' +
      '<td><div class="ci" style="padding:5px 4px;display:flex;flex-direction:column;gap:5px;align-items:stretch">' +
        '<div style="text-align:center">' + buildInputStatus(r) + '</div>' +
        '<button class="btn-tr" onclick="saveRow(' + i + ')" ' +
        'style="width:100%;' +
        (r._dirty ? 'background:#fee2e2;border-color:#fca5a5;color:var(--red);font-weight:700' : '') + '">💾 저장</button>' +
      '</div></td>' +
    '</tr>';
  }).join('');
  autoResizeAll();
}

function buildInputStatus(r) {
  if (!r.sourceText) return '<span class="sbadge s-draft">미입력</span>';
  if (r._dirty || !r.rowIndex) return '<span style="font-size:10px;font-weight:700;color:var(--red)">● 미저장</span>';
  return '<span class="sbadge s-reviewed">입력완료</span>';
}

function onInputSourceChange(i, val) {
  APP.rows[i].sourceText = val;
  APP.rows[i]._dirty = true;
  var cell = document.querySelector('#irow_' + i + ' td:last-child .ci');
  if (cell) cell.innerHTML =
    '<div style="text-align:center">' + buildInputStatus(APP.rows[i]) + '</div>' +
    '<button class="btn-tr" onclick="saveRow(' + i + ')" ' +
    'style="width:100%;background:#fee2e2;border-color:#fca5a5;color:var(--red);font-weight:700">💾 저장</button>';
}

// ── 2단계 파이프라인 (단일 행) ────────────────────────────────
async function pipelineRow(i) {
  var row = APP.rows[i];
  if (!row.sourceText || !row.sourceText.trim()) { toast('원문이 없습니다.', 'error'); return; }

  showProgress('번역 진행 중', 1, 2);
  setProgress(0, '1단계: 번역 중...', row.student.name);

  try {
    var res = await API.runPipeline({
      step: 'both',
      sourceLang: document.getElementById('selSrc').value,
      targetLang: document.getElementById('selTgt').value,
      text: row.sourceText,
      studentName: row.student.name,
      subjectName: APP.selectedSubject ? APP.selectedSubject.nameKR : '',
      subjectCode: APP.selectedSubject ? APP.selectedSubject.subjectCode : '',
      semester: document.getElementById('selSem').value
    });
    if (!res.success) {
      hideProgress();
      if (res.error && res.error.indexOf('NO_API_KEY') !== -1) showApiKeyAlert(res.error.replace('NO_API_KEY:',''));
      else toast('번역 실패: ' + res.error, 'error');
      return;
    }
    setProgress(100, '완료', row.student.name);
    if (res.translatedDraft) row.translatedDraft = res.translatedDraft;
    if (res.finalText) row.finalText = res.finalText;
    if (res.memo) row.aiMemo = res.memo;
    row.status = 'ai_draft';  // AI 생성 → 검수 전 상태
    row._dirty = true;
    refreshRow(i);
    setTimeout(hideProgress, 400);
    toast('번역 완료 ✓', 'success');
  } catch(err) {
    hideProgress();
    toast('오류: ' + err.message, 'error');
  }
}

// ── 2단계 파이프라인 (전체) ───────────────────────────────────
async function pipelineAll() {
  var targets = APP.rows.filter(function(r) { return r.sourceText && r.sourceText.trim() && !r.finalText; });
  if (!targets.length) { toast('번역할 항목이 없습니다.', 'error'); return; }

  // 건수 많으면 경고 (GAS quota 대비)
  if (targets.length > 30) {
    if (!confirm(targets.length + '명을 한 번에 번역합니다.\n\n' +
        '대량 번역은 AI 응답 한도(quota)에 걸리거나 시간이 오래 걸릴 수 있습니다.\n' +
        '30명 이하로 나눠 진행하는 것을 권장합니다.\n\n계속하시겠습니까?')) {
      return;
    }
  }

  APP.progressCancelled = false;
  showProgress('전체 번역 진행 중', 1, targets.length);

  var okCount = 0, failCount = 0, quotaHit = false;

  for (var idx = 0; idx < targets.length; idx++) {
    if (APP.progressCancelled) { break; }
    var row = targets[idx];
    var i = APP.rows.indexOf(row);
    var pct = Math.round((idx / targets.length) * 100);
    setProgress(pct, (idx+1) + '/' + targets.length + ' 번역 중...', row.student.name);

    try {
      var res = await API.runPipeline({
        step: 'both',
        sourceLang: document.getElementById('selSrc').value,
        targetLang: document.getElementById('selTgt').value,
        text: row.sourceText,
        studentName: row.student.name,
        subjectName: APP.selectedSubject ? APP.selectedSubject.nameKR : '',
      subjectCode: APP.selectedSubject ? APP.selectedSubject.subjectCode : '',
      semester: document.getElementById('selSem').value
      });
      if (res.success) {
        if (res.translatedDraft) row.translatedDraft = res.translatedDraft;
        if (res.finalText) row.finalText = res.finalText;
        if (res.memo) row.aiMemo = res.memo;
        row.status = 'ai_draft';
        row._dirty = true;
        refreshRow(i);
        okCount++;
      } else {
        failCount++;
        // quota/한도 관련 오류 감지 시 중단
        if (res.error && (res.error.indexOf('quota') !== -1 ||
            res.error.indexOf('한도') !== -1 || res.error.indexOf('limit') !== -1 ||
            res.error.indexOf('혼잡') !== -1)) {
          quotaHit = true;
          break;
        }
      }
    } catch(e) { failCount++; }

    // rate limit 완화: 호출 간 짧은 지연
    if (idx < targets.length - 1) await new Promise(function(r){ setTimeout(r, 300); });
  }

  setProgress(100, '완료', '');
  setTimeout(hideProgress, 500);

  var msg = '번역 완료: ' + okCount + '명 성공';
  if (failCount) msg += ', ' + failCount + '명 실패';
  if (quotaHit) msg += ' (한도 도달 — 잠시 후 나머지를 다시 시도하세요)';
  toast(msg + ' ✓', quotaHit || failCount ? 'error' : 'success');

  // 결과를 잃지 않도록 일괄 저장 안내 (AI초안 상태 유지)
  if (okCount > 0) {
    setTimeout(function() {
      if (confirm('번역된 ' + okCount + '명의 결과를 저장하시겠습니까?\n(저장하지 않으면 새로고침 시 사라집니다)\n\n※ 저장 후에도 검수 교사가 확인·저장해야 검수완료됩니다.')) {
        saveAllAiDraft();
      }
    }, 700);
  }
}

// 번역 직후 일괄 저장 (ai_draft 상태 유지)
async function saveAllAiDraft() {
  var targets = APP.rows.filter(r => r.status === 'ai_draft' && r._dirty);
  if (!targets.length) { toast('저장할 항목이 없습니다.', 'success'); return; }
  var btn = document.getElementById('btnSaveAll');
  if (btn) { btn.disabled = true; btn.textContent = '저장 중...'; }
  var ok = 0, fail = 0;
  for (var idx = 0; idx < targets.length; idx++) {
    var i = APP.rows.indexOf(targets[idx]);
    try { await saveRow(i, { keepAiDraft: true }); ok++; } catch(e) { fail++; }
    if (btn) btn.textContent = '저장 중... ' + (idx+1) + '/' + targets.length;
  }
  if (btn) { btn.disabled = false; btn.textContent = '💾 일괄 저장'; }
  toast('저장 완료: ' + ok + '건' + (fail ? ', ' + fail + '건 실패' : '') + ' ✓', fail ? 'error' : 'success');
  renderTable();
}

// ── 진행 팝업 ──────────────────────────────────────────────────
function showProgress(title, cur, total) {
  document.getElementById('progTitle').textContent = title;
  document.getElementById('progOverlay') || document.getElementById('progressOverlay').classList.add('open');
  document.getElementById('progressOverlay').classList.add('open');
}
function setProgress(pct, text, step) {
  var bar = document.getElementById('progBar');
  if (bar) bar.style.width = pct + '%';
  var t = document.getElementById('progText');
  if (t) t.textContent = text;
  var s = document.getElementById('progStep');
  if (s) s.textContent = step || '';
}
function hideProgress() {
  document.getElementById('progressOverlay').classList.remove('open');
}
function cancelProgress() {
  APP.progressCancelled = true;
  hideProgress();
}

// ── 테이블 렌더링 ────────────────────────────────────────────
function renderTable() {
  var body = document.getElementById('mainBody');
  var head = document.getElementById('mainHead');
  var table = document.getElementById('mainTable');
  var empty = document.getElementById('emptyTrans');
  var role = APP.teacher.role;

  if (!APP.rows.length) { showEmptyTrans(); return; }

  table.style.display = '';
  empty.style.display = 'none';

  var colsInfo = '<colgroup>' +
    '<col style="width:6%">' +   // Name EN
    '<col style="width:4%">' +   // 이름
    '<col style="width:2.5%">' + // Gr.
    '<col style="width:2.5%">' + // Cls.
    '<col style="width:4%">' +   // NEIS
    '<col style="width:21%">' +  // Source
    '<col style="width:3%">' +   // 번역
    '<col style="width:21%">' +  // 번역 초본
    '<col style="width:21%">' +  // 최종본
    '<col style="width:3%">' +   // 검토
    '<col style="width:7%">' +   // 검수 코멘트
    '<col style="width:3%">' +   // 글자수
    '<col style="width:5%">' +   // 상태
    '</colgroup>';

  // colgroup을 테이블에 삽입
  var tableEl = document.getElementById('mainTable');
  var existingCols = tableEl.querySelector('colgroup');
  if (existingCols) existingCols.remove();
  tableEl.insertAdjacentHTML('afterbegin', colsInfo);

  head.innerHTML = '<tr>' +
    '<th>Name (EN)</th>' +
    '<th>이름</th>' +
    '<th>Gr.</th><th>Cls.</th><th>NEIS</th>' +
    '<th class="ths">Source (원문)</th>' +
    '<th>번역</th>' +
    '<th class="tht">번역 초본</th>' +
    '<th class="thf">최종본</th>' +
    '<th>검토</th>' +
    '<th>NEIS 검토 <button type="button" onclick="showNeisHelp()" ' +
      'style="background:var(--teal);color:#fff;border:none;border-radius:50%;' +
      'width:16px;height:16px;font-size:10px;cursor:pointer;font-weight:700;' +
      'line-height:16px;padding:0;vertical-align:middle">?</button></th>' +
    '<th>글자수</th><th>상태</th>' +
    '</tr>';

  body.innerHTML = APP.rows.map((r, i) => rowHtml(r, i, role)).join('');
  autoResizeAll();
}

// 번역 대기 배지 갱신 (원문 있고 최종본 없는 항목 수)
function updateTransBadge() {
  var badge = document.getElementById('transBadge');
  if (!badge) return;

  var count = 0;
  var tm = APP.cache.transMap || {};
  Object.keys(tm).forEach(function(key) {
    var rec = tm[key];
    // 원문 있고 아직 검수완료가 아니면 대기
    if (rec.sourceText && rec.sourceText.trim() && rec.status !== 'reviewed') {
      count++;
    }
  });

  if (count > 0) {
    badge.textContent = count;
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
}

// 모든 textarea 높이를 내용에 맞춤
function autoResizeAll() {
  setTimeout(function() {
    document.querySelectorAll('#mainTable textarea.cta, #inputTable textarea.cta').forEach(autoResize);
  }, 0);
}
function autoResize(ta) {
  if (!ta) return;
  ta.style.height = 'auto';
  ta.style.height = Math.max(76, ta.scrollHeight) + 'px';
}

function rowHtml(r, i, role) {
  var s = r.student;
  var txt = r.finalText || r.translatedDraft || '';
  var cc = txt.length;
  var ccCls = cc === 0 ? '' : cc > 500 ? 'cc-over' : cc > 450 ? 'cc-warn' : 'cc-ok';
  // 최종본에서 AI원본(translatedDraft) 대비 직접 수정한 부분 하이라이트
  var finalDiff = (r.finalText && r.translatedDraft && r.finalText !== r.translatedDraft)
    ? buildFinalDiffHtml(r.translatedDraft, r.finalText) : '';

  return `<tr id="row_${i}">
    <td><div class="ci" style="font-size:11px">${e(s.engName||'-')}</div></td>
    <td><div class="ci" style="font-size:11px">${e(s.name)}</div></td>
    <td><div class="ci">${s.grade}</div></td>
    <td><div class="ci">${s.class}</div></td>
    <td><div class="ci ci-neis">${e(s.neis||s.neisClass||'')}</div></td>
    <td><textarea class="cta src" readonly
      style="background:#f8fafc;color:var(--text2)">${e(r.sourceText)}</textarea></td>
    <td class="ca">
      <button class="btn-arrow" onclick="pipelineRow(${i})" title="번역"
        ${r.translating?'disabled':''} style="font-size:16px;background:none;border:none;
        cursor:pointer;color:var(--teal);padding:4px;transition:transform 0.15s"
        onmouseover="this.style.transform='scale(1.3)'"
        onmouseout="this.style.transform='scale(1)'">
        ${r.translating ? '⏳' : '▶'}
      </button>
    </td>
    <td>
      <textarea class="cta drft" readonly id="drft_${i}"
        style="background:#f8fafc;color:var(--text2)">${e(r.translatedDraft)}</textarea>
      <div class="ai-memo" id="amemo_${i}"
        style="${r.aiMemo && r.aiMemo!=='해당 없음' ? '' : 'display:none'};
        margin-top:4px;padding:6px;font-size:10px;line-height:1.5;
        background:#fef9c3;border:1px solid #fde047;border-radius:4px;
        color:#854d0e;white-space:pre-wrap">📌 ${e(r.aiMemo)}</div>
    </td>
    <td>
      <textarea class="cta fnl" id="fnl_${i}" oninput="onFinalChange(${i},this.value);autoResize(this)">${e(r.finalText)}</textarea>
      <div class="final-diff" id="fdiff_${i}"
        style="${finalDiff?'':'display:none'};padding:6px 6px;font-size:11px;line-height:1.6;
        word-break:break-word;background:#fffdf5;border-top:1px dashed #fbbf24">
        <div style="font-size:9px;color:var(--gray);margin-bottom:3px">🟦 AI번역 · 🟩 직접수정</div>
        ${finalDiff}
      </div>
    </td>
    <td class="ca">
      <button class="btn-arrow" onclick="runNeisCheck(${i})" title="NEIS 검토"
        style="font-size:14px;background:none;border:none;cursor:pointer;
        color:var(--primary);padding:4px;transition:transform 0.15s"
        onmouseover="this.style.transform='scale(1.3)'"
        onmouseout="this.style.transform='scale(1)'">🔍</button>
    </td>
    <td><div class="cta cmt" id="neis_cmt_${i}"
      style="min-height:76px;padding:7px 9px;font-size:11px;
      color:var(--text2);background:#fafafa;white-space:pre-wrap">${e(r.comment)}</div></td>
    <td><div class="cc ${ccCls}">
      ${cc>0 ? '<span style="font-size:9px;color:var(--gray);display:block">' +
        (document.getElementById('selSem')?.value==='1'?'1학기':'2학기') +
        '</span>' + cc + '/500' : '-'}
    </div></td>
    <td><div class="ci" style="padding:4px 2px">
      ${buildStatusBadge(r, i)}
      <button class="btn-cp" onclick="saveRow(${i})"
        style="margin-top:5px;width:100%;
        ${r._dirty ? 'background:#fee2e2;border-color:#fca5a5;color:var(--red);font-weight:700' : ''}">
        저장
      </button>
      <button class="btn-cp" onclick="copyFinal(${i})"
        style="margin-top:3px;width:100%">
        복사
      </button>
    </div></td>
  </tr>`;
}

function refreshRow(i) {
  var tr = document.getElementById('row_' + i);
  if (!tr) return;
  var tmp = document.createElement('tbody');
  tmp.innerHTML = rowHtml(APP.rows[i], i, APP.teacher.role);
  var newTr = tmp.firstElementChild;
  newTr.id = 'row_' + i;
  tr.parentNode.replaceChild(newTr, tr);
  // 새 행의 textarea 높이 맞춤
  setTimeout(function() {
    newTr.querySelectorAll('textarea.cta').forEach(autoResize);
  }, 0);
}

function showEmptyTrans() {
  document.getElementById('mainTable').style.display = 'none';
  document.getElementById('emptyTrans').style.display = 'block';
}

// ── 이벤트 ──────────────────────────────────────────────────
function markDirty(i) {
  if (APP.rows[i]) { APP.rows[i]._dirty = true; }
  var td = document.querySelector('#row_' + i + ' td:last-child .ci');
  if (td) td.innerHTML = buildStatusBadge(APP.rows[i], i) +
    '<button class="btn-cp" onclick="saveRow(' + i + ')" ' +
    'style="margin-top:5px;width:100%;background:#fee2e2;border-color:#fca5a5;color:var(--red);font-weight:700">저장</button>' +
    '<button class="btn-cp" onclick="copyFinal(' + i + ')" style="margin-top:3px;width:100%">복사</button>';
}

function onDraftChange(i, val) {
  APP.rows[i].translatedDraft = val;
  markDirty(i);
  updateCC(i);
}
function onFinalChange(i, val) {
  APP.rows[i].finalText = val;
  markDirty(i);
  updateCC(i);
  // 최종본에서 AI원본 대비 직접 수정한 부분 하이라이트 (최종본 칸 아래 미리보기)
  var fdiffEl = document.getElementById('fdiff_' + i);
  var draft   = APP.rows[i].translatedDraft;
  if (fdiffEl && draft) {
    if (val && val !== draft) {
      fdiffEl.innerHTML =
        '<div style="font-size:9px;color:var(--gray);margin-bottom:3px">🟦 AI번역 · 🟩 직접수정</div>' +
        buildFinalDiffHtml(draft, val);
      fdiffEl.style.display = '';
    } else {
      fdiffEl.style.display = 'none';
    }
  }
}
function updateCC(i) {
  var txt = APP.rows[i].finalText || APP.rows[i].translatedDraft || '';
  var cc = txt.length;
  var el = document.querySelector('#row_' + i + ' .cc');
  if (!el) return;
  var cls = cc === 0 ? '' : cc > 500 ? 'cc-over' : cc > 450 ? 'cc-warn' : 'cc-ok';
  var sem = document.getElementById('selSem').value;
  var semLabel = sem === '1' ? '1학기' : '2학기';
  el.innerHTML = cc > 0
    ? '<span style="font-size:9px;color:var(--gray);display:block">' + semLabel + '</span>' + cc + '/500'
    : '-';
  el.className = 'cc ' + cls;
}

function switchTab(tab) {
  APP.currentTab = tab;
  document.getElementById('tab과목').className = 'tab' + (tab==='과목'?' active':'');
  document.getElementById('tab동아리').className = 'tab' + (tab==='동아리'?' active':'');
  renderSubjectSelect();
  showEmptyTrans();
}

function onEngineChange() {
  var engine = document.getElementById('selEngine').value;
  var sel = document.getElementById('selModel');
  sel.innerHTML = (APP.models[engine] || []).map(m => `<option value="${m}">${m}</option>`).join('');

  // Google은 모델/Creativity 불필요 → 숨김
  var isGoogle = engine === 'google';
  var modelCtrl = document.getElementById('selModel').closest('.ctrl-g');
  var creatCtrl = document.getElementById('slCreat')?.closest('.ctrl-g');
  if (modelCtrl) modelCtrl.style.display = isGoogle ? 'none' : '';
  if (creatCtrl) creatCtrl.style.display = isGoogle ? 'none' : '';
}

// 관리자가 상단바에서 엔진/모델/creativity 변경 시 설정 자동 저장
async function saveEngineSettingFromToolbar() {
  if (APP.teacher.role !== '관리자') return;
  var data = {
    engine:     document.getElementById('selEngine').value,
    model:      document.getElementById('selModel').value,
    creativity: document.getElementById('slCreat').value
  };
  try {
    var res = await API.saveSettings(data);
    if (res.success) {
      if (APP.settings) {
        APP.settings.engine = data.engine;
        APP.settings.model = data.model;
        APP.settings.creativity = data.creativity;
      }
      toast('엔진 설정 저장됨 ✓', 'success');
    }
  } catch(e) {}
}

function setView(btn) {
  var view = btn.dataset.view;
  APP.currentView = view;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('vInput').style.display     = view === 'input'     ? '' : 'none';
  document.getElementById('vTranslate').style.display = view === 'translate' ? '' : 'none';
  document.getElementById('vAdmin').style.display     = view === 'admin'     ? '' : 'none';

  // 관리 탭: toolbar는 유지하되 번역 전용 컨트롤(.trans-only)만 숨김, 엔진 설정은 표시
  var isAdmin = view === 'admin';
  toggleToolbarMode(isAdmin);
  document.getElementById('tabs').style.display = isAdmin ? 'none' : '';

  // 뷰 전환 시 현재 선택 과목 다시 렌더
  if (view === 'input' || view === 'translate') {
    if (APP.selectedSubject) renderCurrentView();
    else { showEmptyForView(view); }
  }
  if (view === 'admin') { renderAdminTab(); }
}

function showEmptyForView(view) {
  if (view === 'input') {
    document.getElementById('inputTable').style.display = 'none';
    document.getElementById('emptyInput').style.display = 'block';
  } else if (view === 'translate') {
    document.getElementById('mainTable').style.display = 'none';
    document.getElementById('emptyTrans').style.display = 'block';
  }
}

// 현재 뷰에 맞는 테이블 렌더
function renderCurrentView() {
  if (APP.currentView === 'input')     renderInputTable();
  else if (APP.currentView === 'translate') renderTable();
}

// ── 번역 ────────────────────────────────────────────────────
function getPayload(row) {
  return {
    engine:     document.getElementById('selEngine').value,
    model:      document.getElementById('selModel').value,
    creativity: parseFloat(document.getElementById('slCreat').value),
    prompt:     APP.prompt,
    sourceLang: document.getElementById('selSrc').value,
    targetLang: document.getElementById('selTgt').value,
    text:       row.sourceText,
    studentName: row.student.name + ' / ' + row.student.engName,
    subjectName: APP.selectedSubject ? APP.selectedSubject.nameKR + ' / ' + APP.selectedSubject.nameEN : ''
  };
}

async function translateRow(i) {
  var row = APP.rows[i];
  if (!row.sourceText.trim()) { toast('원문을 입력하세요.', 'error'); return; }
  row.translating = true;
  refreshRow(i);

  try {
    var res = await API.translate(getPayload(row));
    row.translating = false;
    if (!res.success) {
      if (res.error && res.error.startsWith('NO_API_KEY:')) {
        showApiKeyAlert(res.error.replace('NO_API_KEY:', ''));
      } else {
        toast('번역 실패: ' + res.error, 'error');
      }
    } else {
      row.translatedDraft = res.text;
      if (!row.finalText) row.finalText = res.text;
      row._dirty = true;
      toast('번역 완료 ✓', 'success');
    }
  } catch(e) {
    row.translating = false;
    toast('오류: ' + e.message, 'error');
  }
  refreshRow(i);
}

async function translateAll() {
  var pending = APP.rows.filter(r => r.sourceText.trim() && !r.translatedDraft);
  if (!pending.length) { toast('번역할 항목이 없습니다.', 'error'); return; }
  for (var r of pending) {
    var i = APP.rows.indexOf(r);
    r.translating = true; refreshRow(i);
    try {
      var res = await API.translate(getPayload(r));
      if (res.success) { r.translatedDraft = res.text; if (!r.finalText) r.finalText = res.text; }
    } catch(e) {}
    r.translating = false; refreshRow(i);
  }
  toast('전체 번역 완료 ✓', 'success');
}

// ── 저장 ────────────────────────────────────────────────────
async function saveRow(i, opts) {
  opts = opts || {};
  var row = APP.rows[i];
  var s = APP.selectedSubject;
  if (!s) { toast('과목을 선택하세요.', 'error'); return; }

  try {
    var res;
    // 저장 시 상태 결정
    // - 입력 탭(외국인 교사): 원문만 저장 → draft
    // - 번역 직후 일괄저장(keepAiDraft): AI초안 상태 유지 → ai_draft
    // - 번역 탭에서 사람이 직접 저장: 최종본 있으면 reviewed (검수 완료)
    var saveStatus;
    if (APP.currentView === 'input') {
      saveStatus = 'draft';
    } else if (opts.keepAiDraft && row.status === 'ai_draft') {
      saveStatus = 'ai_draft';
    } else {
      saveStatus = row.finalText ? 'reviewed' : 'draft';
    }

    // 신규/수정 모두 새 행으로 추가 (기존 데이터 보존)
    var record = {
      year:         document.getElementById('selYear').value,
      semester:     document.getElementById('selSem').value,
      type:         APP.currentTab,
      subjectCode:  s.subjectCode, subjectNameKR: s.nameKR, subjectNameEN: s.nameEN,
      studentName:  row.student.name, studentNameEN: row.student.engName,
      grade:        row.student.grade, class: row.student.class,
      neisClass:    row.student.neisClass, neisNo: row.student.neisNo,
      sourceLang:   document.getElementById('selSrc').value,
      targetLang:   document.getElementById('selTgt').value,
      model:        document.getElementById('selModel').value,
      creativity:   document.getElementById('slCreat').value,
      prompt:       APP.prompt,
      sourceText:      row.sourceText,
      translatedDraft: row.translatedDraft,
      finalText:       row.finalText,
      reviewerComment: row.comment,
      status:          saveStatus
    };
    res = await API.saveTrans(record);
    if (res && res.success) row.rowIndex = res.rowIndex;
    if (res && res.success) {
      row.status = saveStatus;
      row._dirty = false;
      // 캐시 갱신
      if (APP.selectedSubject) {
        var cacheKey = APP.selectedSubject.subjectCode + '|' + row.student.name;
        APP.cache.transMap[cacheKey] = {
          rowIndex:        row.rowIndex,
          sourceText:      row.sourceText,
          translatedDraft: row.translatedDraft,
          finalText:       row.finalText,
          reviewerComment: row.comment,
          status:          row.status
        };
      }
      updateTransBadge();
      refreshSubjectDropdownCounts();
      // 현재 뷰에 맞는 행 갱신
      if (APP.currentView === 'input') {
        renderInputTable();
      } else {
        refreshRow(i);
      }
      toast('저장 완료 ✓', 'success');
    } else {
      toast('저장 실패: ' + (res && res.error || ''), 'error');
    }
  } catch(e) { toast(e.message, 'error'); }
}

// ── 일괄 저장 ──────────────────────────────────────────────────
async function saveAll() {
  var s = APP.selectedSubject;
  if (!s) { toast('과목을 선택하세요.', 'error'); return; }

  // 내용이 있고 미저장인 행만 대상
  var targets = APP.rows.filter(r => (r.sourceText || r.translatedDraft) && (!r.rowIndex || r._dirty));
  if (!targets.length) {
    toast('저장할 항목이 없습니다. (이미 모두 저장됨)', 'success'); return;
  }

  var btn = document.getElementById('btnSaveAll');
  if (btn) { btn.disabled = true; btn.textContent = '저장 중...'; }

  var ok = 0, fail = 0;
  for (var idx = 0; idx < targets.length; idx++) {
    var i = APP.rows.indexOf(targets[idx]);
    try {
      await saveRow(i);
      ok++;
    } catch(err) {
      fail++;
    }
    // 진행 상황 버튼에 표시
    if (btn) btn.textContent = '저장 중... ' + (idx+1) + '/' + targets.length;
  }

  if (btn) { btn.disabled = false; btn.textContent = '💾 일괄 저장'; }
  toast('일괄 저장 완료: ' + ok + '건 성공' + (fail ? ', ' + fail + '건 실패' : '') + ' ✓', fail ? 'error' : 'success');
  renderTable(); // 상태 아이콘 갱신
}

// ── NEIS 엑셀 다운로드 ──────────────────────────────────────────
function downloadExcel() {
  if (!APP.rows || !APP.rows.length) { toast('다운로드할 데이터가 없습니다.', 'error'); return; }
  if (!APP.selectedSubject) { toast('과목을 선택하세요.', 'error'); return; }

  var year = document.getElementById('selYear').value;
  var sem  = document.getElementById('selSem').value;
  var subj = APP.selectedSubject;
  var TAB  = '\t';
  var CRLF = '\r\n';

  var headers = ['학년도','학기','학년','학생개인번호','과목','과목코드',
    '반/번호','성명','학적변동  구분','세부능력 및 특기사항',
    '영재\u00b7발명교육 기록사항','유의어  점검내역'];

  var rows = [headers];

  APP.rows.forEach(function(r) {
    var s        = r.student;
    var neisClass = s.neisClass || s.class  || '';
    var neisNo    = s.neisNo    || s.number || '';
    var hanBan    = (neisClass && neisNo) ? neisClass + '/' + neisNo : '';
    var finalTxt  = r.finalText || r.translatedDraft || '';

    rows.push([
      year, sem, s.grade || '', s.neis || '',
      subj.nameKR, '', hanBan, s.name || '',
      '재학', finalTxt, '',
      finalTxt ? '없음' : ''
    ]);
    rows.push(['','','','','','','','','','','','']);
  });

  function escCell(cell) {
    var v = String(cell == null ? '' : cell);
    if (v.indexOf(TAB) !== -1 || v.indexOf('\n') !== -1 || v.indexOf('"') !== -1) {
      return '"' + v.replace(/"/g, '""') + '"';
    }
    return v;
  }

  var tsv = rows.map(function(r) {
    return r.map(escCell).join(TAB);
  }).join(CRLF);

  var bom  = '\uFEFF';
  var blob = new Blob([bom + tsv], { type: 'text/tab-separated-values;charset=utf-8' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');

  var now   = new Date();
  function pad(n) { return String(n).padStart(2, '0'); }
  var stamp = now.getFullYear() + pad(now.getMonth()+1) + pad(now.getDate()) +
              pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
  var grade = APP.rows[0] ? APP.rows[0].student.grade : '';
  var cls   = APP.rows[0] ? (APP.rows[0].student.neisClass || APP.rows[0].student.class) : '';
  a.download = year + '_' + sem + '학기_' + grade + '학년_' + cls + '_' +
               subj.nameKR + '_과목세특_' + stamp + '.tsv';
  a.href = url;
  a.click();
  URL.revokeObjectURL(url);
  toast('다운로드 완료 ✓', 'success');
}

// ── NEIS 검토 ────────────────────────────────────────────────
// 최종본 단어 단위 diff: AI원본과 같은 부분=파랑, 수정/추가=초록
function buildFinalDiffHtml(aiDraft, finalText) {
  if (!aiDraft || !finalText) return e(finalText || '');
  // 단어(공백 포함) 단위 토큰화
  var a = aiDraft.split(/(\s+)/);
  var b = finalText.split(/(\s+)/);

  // LCS 테이블
  var n = a.length, m = b.length;
  var dp = [];
  for (var i = 0; i <= n; i++) dp[i] = new Array(m + 1).fill(0);
  for (var i = n - 1; i >= 0; i--) {
    for (var j = m - 1; j >= 0; j--) {
      dp[i][j] = (a[i] === b[j]) ? dp[i+1][j+1] + 1 : Math.max(dp[i+1][j], dp[i][j+1]);
    }
  }
  // b 기준으로 재구성: 공통=파랑, b에만 있음(추가/수정)=초록
  var out = '', i2 = 0, j2 = 0;
  function blue(t){ return '<span style="color:#2563eb">' + e(t) + '</span>'; }
  function green(t){ return '<span style="color:#16a34a;font-weight:600;background:#dcfce7;border-radius:2px">' + e(t) + '</span>'; }
  while (j2 < m) {
    if (i2 < n && a[i2] === b[j2]) {       // 공통
      out += blue(b[j2]); i2++; j2++;
    } else if (i2 < n && dp[i2+1][j2] >= dp[i2][j2+1]) {
      i2++;                                 // AI에만 있던 단어 삭제됨 → 표시 안 함
    } else {
      out += green(b[j2]); j2++;            // 최종본에만 있는 단어 = 직접 작성
    }
  }
  return out;
}

async function runNeisCheck(i) {
  var txt = APP.rows[i].finalText || APP.rows[i].translatedDraft;
  if (!txt) { toast('검토할 텍스트가 없습니다.', 'error'); return; }
  var cmtEl = document.getElementById('neis_cmt_' + i);
  if (cmtEl) cmtEl.textContent = '검토 중...';
  try {
    var res = await API.neisValidate(txt);
    if (!res.success) return;
    var d = res.data;
    var msg = '';
    if (d.warnings && d.warnings.length) {
      msg = '⚠️ ' + d.warnings.join('\n⚠️ ');
    } else {
      msg = '✓ 이상 없음';
    }
    APP.rows[i].comment = msg;
    if (cmtEl) cmtEl.textContent = msg;
    markDirty(i); // 검토 결과 저장 활성화
  } catch(err) {
    if (cmtEl) cmtEl.textContent = '검토 오류: ' + err.message;
  }
}

async function checkNeis(i) {
  var txt = APP.rows[i].finalText || APP.rows[i].translatedDraft;
  if (!txt) { toast('검토할 텍스트가 없습니다.', 'error'); return; }
  try {
    var res = await API.neisValidate(txt);
    if (!res.success) return;
    var d = res.data;
    alert('[NEIS 검토 결과]\n글자수: ' + d.charCount + '/500\n\n' +
      (d.warnings.length ? d.warnings.join('\n') : '✓ 이상 없음'));
  } catch(e) { toast(e.message, 'error'); }
}

// ── 검수 뷰 ─────────────────────────────────────────────────
async function loadReviewList() {
  // 캐시가 있으면 즉시 렌더링
  if (APP.cache.loaded) {
    renderReviewTable(getReviewDataFromCache());
    return;
  }
  // 캐시 없으면 API 호출
  showLoading('검수 목록 불러오는 중...');
  var t = APP.teacher;
  var filters = {
    year:     document.getElementById('selYear').value,
    semester: document.getElementById('selSem').value
  };
  if (APP.selectedSubject) filters.subjectCode = APP.selectedSubject.subjectCode;
  if (t.role === '검수' && t.assignedTo) {
    filters.assignedTeachers = t.assignedTo.split(',').map(s => s.trim()).filter(Boolean);
  }
  try {
    var res = await API.getTransList(filters);
    hideLoading();
    renderReviewTable(res.data || []);
  } catch(e) { hideLoading(); toast(e.message, 'error'); }
}

function getReviewDataFromCache() {
  var subjectCode = APP.selectedSubject ? APP.selectedSubject.subjectCode : null;
  var assignedTeachers = [];
  var t = APP.teacher;
  if (t.role === '검수' && t.assignedTo) {
    assignedTeachers = t.assignedTo.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
  }

  var results = [];
  // transMap key = subjectCode|studentName → 최신 레코드만 있음
  Object.keys(APP.cache.transMap).forEach(function(key) {
    var rec = APP.cache.transMap[key];
    // 과목 필터
    var parts = key.split('|');
    var recCode = parts[0];
    if (subjectCode && recCode !== subjectCode) return;
    // 검수 교사 담당 필터 (teacherName 기준)
    if (assignedTeachers.length && assignedTeachers.indexOf(rec.teacherName || '') === -1) return;

    results.push({
      rowIndex:        rec.rowIndex,
      studentName:     parts[1] || '',
      studentNameEN:   rec.studentNameEN || '',
      grade:           rec.grade || '',
      subjectNameKR:   rec.subjectNameKR || recCode,
      translatedDraft: rec.translatedDraft || '',
      finalText:       rec.finalText || '',
      reviewerComment: rec.reviewerComment || '',
      status:          rec.status || 'draft'
    });
  });

  // 과목 → 학생명 순 정렬
  results.sort(function(a, b) {
    if (a.subjectNameKR !== b.subjectNameKR) return a.subjectNameKR.localeCompare(b.subjectNameKR, 'ko');
    return a.studentName.localeCompare(b.studentName, 'ko');
  });
  return results;
}

function renderReviewTable(data) {
  var table = document.getElementById('reviewTable');
  var empty = document.getElementById('emptyReview');
  if (!data.length) { table.style.display='none'; empty.style.display=''; return; }
  table.style.display = ''; empty.style.display = 'none';

  document.getElementById('reviewHead').innerHTML =
    '<tr><th>학생</th><th>영문명</th><th>Gr.</th><th>과목</th>' +
    '<th style="min-width:220px">번역 초본</th><th style="min-width:220px">최종본</th>' +
    '<th style="min-width:130px">코멘트</th><th>글자수</th><th>상태</th><th>작업</th></tr>';

  document.getElementById('reviewBody').innerHTML = data.map(r => {
    var cc = (r.finalText || r.translatedDraft || '').length;
    var ccCls = cc > 500 ? 'cc-over' : cc > 450 ? 'cc-warn' : 'cc-ok';
    return `<tr>
      <td><div class="ci">${e(r.studentName)}</div></td>
      <td><div class="ci">${e(r.studentNameEN)}</div></td>
      <td><div class="ci">${r.grade}</div></td>
      <td><div class="ci" style="font-size:11px">${e(r.subjectNameKR)}</div></td>
      <td><textarea class="cta drft" id="rv_d_${r.rowIndex}">${e(r.translatedDraft)}</textarea></td>
      <td><textarea class="cta fnl"  id="rv_f_${r.rowIndex}">${e(r.finalText)}</textarea></td>
      <td><textarea class="cta cmt"  id="rv_c_${r.rowIndex}">${e(r.reviewerComment)}</textarea></td>
      <td><div class="cc ${ccCls}">${cc}/500</div></td>
      <td><div class="ci"><span class="sbadge s-${r.status}">${r.status}</span></div></td>
      <td class="ca">
        <button class="btn-tr" onclick="saveReview(${r.rowIndex})">저장</button>
        <button class="btn-cp" onclick="copyReview(${r.rowIndex})" style="margin-top:3px">NEIS 복사</button>
      </td>
    </tr>`;
  }).join('');
}

async function saveReview(rowIndex) {
  var fields = {
    finalText: document.getElementById('rv_f_' + rowIndex)?.value || '',
    reviewerComment: document.getElementById('rv_c_' + rowIndex)?.value || '',
    status: 'reviewed'
  };
  try {
    var res = await API.updateTrans(rowIndex, fields);
    if (res.success) toast('검수 저장 완료 ✓', 'success');
    else toast('저장 실패', 'error');
  } catch(e) { toast(e.message, 'error'); }
}

function copyReview(rowIndex) {
  var el = document.getElementById('rv_f_' + rowIndex);
  if (!el?.value) { toast('최종본이 없습니다.', 'error'); return; }
  copyToClipboard(el.value);
  toast('클립보드 복사 완료 ✓', 'success');
}

// ── 번역 이력 뷰 ────────────────────────────────────────────
// 이력: 전체를 한 번만 로드, 과목 변경 시 클라이언트 필터링
var _historyAll  = null;  // 전체 이력 (연도/학기 기준)
var _historyYear = '';
var _historySem  = '';

async function loadHistoryList() {
  var year = document.getElementById('selYear').value;
  var sem  = document.getElementById('selSem').value;

  // 연도/학기가 같으면 전체 재호출 없이 클라이언트 필터링
  if (_historyAll && _historyYear === year && _historySem === sem) {
    renderHistoryTable(filterHistory(_historyAll));
    return;
  }

  showLoading('이력 불러오는 중...');
  var t = APP.teacher;
  var filters = { year: year, semester: sem };
  if (t.role === '검수' && t.assignedTo) {
    filters.assignedTeachers = t.assignedTo.split(',').map(s => s.trim()).filter(Boolean);
  }
  try {
    var res = await API.getTransHistory(filters);
    hideLoading();
    _historyAll  = res.data || [];
    _historyYear = year;
    _historySem  = sem;
    renderHistoryTable(filterHistory(_historyAll));
  } catch(e) { hideLoading(); toast(e.message, 'error'); }
}

function filterHistory(data) {
  var subjectCode = APP.selectedSubject ? APP.selectedSubject.subjectCode : '';
  if (!subjectCode) return data;
  return data.filter(function(r) { return r.subjectCode === subjectCode; });
}

function renderHistoryTable(data) {
  var wrap = document.getElementById('historyContent');
  if (!data.length) {
    wrap.innerHTML = '<div class="empty-state"><div class="eicon">📋</div><p>이력이 없습니다.</p></div>';
    return;
  }

  // 학생별 그룹핑
  var groups = {};
  var groupOrder = [];
  data.forEach(function(r) {
    var key = r.subjectNameKR + ' | ' + r.studentName;
    if (!groups[key]) { groups[key] = []; groupOrder.push(key); }
    groups[key].push(r);
  });

  wrap.innerHTML = groupOrder.map(function(key) {
    var rows = groups[key];
    var first = rows[0];
    return '<div style="margin-bottom:16px;border:1px solid var(--border);border-radius:8px;overflow:hidden">' +
      '<div style="background:var(--bg3);padding:8px 12px;font-size:12px;font-weight:600;color:var(--text)">' +
        e(first.subjectNameKR) + ' — ' + e(first.studentName) + ' (' + e(first.studentNameEN) + ')' +
        ' <span style="font-size:11px;color:var(--gray);font-weight:400">총 ' + rows.length + '건</span>' +
      '</div>' +
      '<table class="sheet" style="width:100%"><thead><tr>' +
        '<th style="width:8%">저장일시</th><th style="width:5%">저장자</th>' +
        '<th style="width:22%">번역 초본</th><th style="width:22%">최종본</th>' +
        '<th style="width:15%">코멘트</th><th style="width:5%">글자수</th><th style="width:5%">상태</th>' +
      '</tr></thead><tbody>' +
      rows.map(function(r) {
        var cc = (r.finalText || r.translatedDraft || '').length;
        var ccCls = cc > 500 ? 'cc-over' : cc > 450 ? 'cc-warn' : 'cc-ok';
        var date = r.createdAt ? new Date(r.createdAt).toLocaleString('ko-KR',
          {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '-';
        return '<tr>' +
          '<td><div class="ci" style="font-size:10px">' + date + '</div></td>' +
          '<td><div class="ci" style="font-size:11px">' + e(r.updatedBy||r.teacherName) + '</div></td>' +
          '<td><div class="cta drft" style="min-height:40px;background:#f8fafc;padding:6px;font-size:11px;overflow:auto">' + e(r.translatedDraft) + '</div></td>' +
          '<td><div class="cta fnl"  style="min-height:40px;padding:6px;font-size:11px;overflow:auto">' + e(r.finalText) + '</div></td>' +
          '<td><div style="padding:6px;font-size:11px;color:var(--text2)">' + e(r.reviewerComment) + '</div></td>' +
          '<td><div class="cc ' + ccCls + '">' + (cc||'-') + '</div></td>' +
          '<td><div class="ci"><span class="sbadge s-' + r.status + '">' + r.status + '</span></div></td>' +
        '</tr>';
      }).join('') +
      '</tbody></table></div>';
  }).join('');
}

// ── 관리 뷰 ─────────────────────────────────────────────────
var _teacherData = [];

async function loadTeacherList() {
  var cl = document.getElementById('curriculumList');
  if (cl) cl.innerHTML = '';
  try {
    var res = await API.getTeachers();
    if (!res.success) { toast('로드 실패', 'error'); return; }
    _teacherData = res.data;
    renderTeacherTable();
  } catch(err) { toast(err.message, 'error'); }
}

function renderTeacherTable() {
  var data = _teacherData;
  var translators = data.filter(t => t.role === '번역').map(t => t.name);

  var html = '<div class="admin-section">' +
    '<h4>👥 교사 권한 관리</h4>' +
    '<table class="sheet" style="min-width:100%"><thead><tr>' +
    '<th>이름</th><th>Full Name</th><th>이메일</th><th>홈룸</th>' +
    '<th>동아리</th><th>권한</th><th>번역담당</th><th style="min-width:120px">변경</th>' +
    '</tr></thead><tbody>' +
    data.map(t => {
      var nameKey = t.name.replace(/[^a-zA-Z0-9가-힣]/g, '_');
      var isReviewer = t.role === '검수';
      return `<tr id="trow_${nameKey}">
        <td><div class="ci">${e(t.name)}</div></td>
        <td><div class="ci" style="font-size:11px">${e(t.fullName)}</div></td>
        <td><div class="ci" style="font-size:11px">${e(t.email)}</div></td>
        <td><div class="ci">${e(t.homeroom)}</div></td>
        <td><div class="ci" style="font-size:11px">${e(t.club||'')}</div></td>
        <td><div class="ci">
          <select id="role_${nameKey}" onchange="onRoleChange('${nameKey}','${t.name}')"
            style="border:1px solid var(--border);border-radius:4px;font-size:11px;padding:3px 6px;background:var(--bg);color:var(--text)">
            ${['번역','검수','관리자','일반'].map(r =>
              `<option value="${r}" ${r===t.role?'selected':''}>${r}</option>`).join('')}
          </select>
        </div></td>
        <td><div class="ci" id="assignWrap_${nameKey}" style="min-width:160px">
          ${isReviewer ? buildAssignDropdown(nameKey, translators, t.assignedTo||'') : '<span style="color:var(--gray);font-size:11px">-</span>'}
        </div></td>
        <td class="ca"><div style="display:flex;gap:4px">
          <button class="btn-tr" onclick="saveTeacher('${nameKey}','${t.name}')" style="flex:1">저장</button>
          <button class="btn-cp" onclick="deleteTeacherRow('${t.name}')"
            style="flex:1;background:#fee2e2;border-color:#fca5a5;color:var(--red)">삭제</button>
        </div></td>
      </tr>`;
    }).join('') +
    '</tbody></table></div>' +

    // 교사 추가
    '<div class="admin-section"><h4>➕ 교사 추가</h4>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">' +
    '<div><div class="flabel">이름</div><input class="finput" id="new_name" placeholder="홍길동" style="width:100px"></div>' +
    '<div><div class="flabel">Full Name</div><input class="finput" id="new_fullname" placeholder="Mr. Gil Dong Hong" style="width:180px"></div>' +
    '<div><div class="flabel">이메일</div><input class="finput" id="new_email" placeholder="email@his.sc.kr" style="width:180px"></div>' +
    '<div><div class="flabel">홈룸</div><input class="finput" id="new_homeroom" placeholder="7A" style="width:60px"></div>' +
    '<div><div class="flabel">동아리</div><input class="finput" id="new_club" placeholder="" style="width:120px"></div>' +
    '<div><div class="flabel">비밀번호</div><input class="finput" id="new_pw" placeholder="뒷4자리" style="width:80px"></div>' +
    '<div><div class="flabel">권한</div><select class="finput" id="new_role" style="width:80px">' +
    ['번역','검수','관리자','일반'].map(r => `<option>${r}</option>`).join('') +
    '</select></div>' +
    '<button class="btn-teal" onclick="addTeacher()">추가</button>' +
    '</div></div>';

  document.getElementById('teacherList').innerHTML = html;
}

function onRoleChange(nameKey, name) {
  var role = document.getElementById('role_' + nameKey)?.value;
  var wrap = document.getElementById('assignWrap_' + nameKey);
  var translators = _teacherData.filter(t => t.role === '번역').map(t => t.name);
  if (role === '검수') {
    wrap.innerHTML = buildAssignDropdown(nameKey, translators, '');
  } else {
    wrap.innerHTML = '<span style="color:var(--gray);font-size:11px">-</span>';
  }
}

async function saveTeacher(nameKey, name) {
  var role = document.getElementById('role_' + nameKey)?.value;
  var assigned = getAssignedValues(nameKey);
  try {
    var res = await API.updateTeacherRole(name, role, assigned);
    if (res.success) { toast(name + ' 저장 완료 ✓', 'success'); loadTeacherList(); }
    else toast('저장 실패', 'error');
  } catch(err) { toast(err.message, 'error'); }
}

async function deleteTeacherRow(name) {
  if (!confirm('[' + name + '] 교사를 삭제하시겠습니까?')) return;
  try {
    var res = await API.deleteTeacher(name);
    if (res.success) { toast(name + ' 삭제 완료 ✓', 'success'); loadTeacherList(); }
    else toast('삭제 실패: ' + res.error, 'error');
  } catch(e) { toast(e.message, 'error'); }
}

async function addTeacher() {
  var teacher = {
    name:     document.getElementById('new_name').value.trim(),
    fullName: document.getElementById('new_fullname').value.trim(),
    email:    document.getElementById('new_email').value.trim(),
    homeroom: document.getElementById('new_homeroom').value.trim(),
    club:     document.getElementById('new_club').value.trim(),
    password: document.getElementById('new_pw').value.trim(),
    role:     document.getElementById('new_role').value
  };
  if (!teacher.name || !teacher.password) { toast('이름과 비밀번호는 필수입니다.', 'error'); return; }
  try {
    var res = await API.addTeacher(teacher);
    if (res.success) {
      toast('교사 추가 완료 ✓', 'success');
      ['name','fullname','email','homeroom','club','pw'].forEach(f =>
        document.getElementById('new_' + f).value = '');
      loadTeacherList();
    } else toast('추가 실패: ' + res.error, 'error');
  } catch(err) { toast(err.message, 'error'); }
}

// ── 번역담당 드롭다운 빌더 ──────────────────────────────────
function buildAssignDropdown(nameKey, translators, assignedStr) {
  var assigned = assignedStr ? assignedStr.split(',').map(s => s.trim()) : [];
  var display = assigned.length ? assigned.join(', ') : '선택...';
  return `<div class="assign-wrap" id="aw_${nameKey}">
    <div class="assign-btn" onclick="toggleAssignList('${nameKey}')"
      style="border:1px solid var(--border);border-radius:6px;padding:4px 8px;
      font-size:11px;cursor:pointer;background:var(--bg);min-width:140px;
      display:flex;justify-content:space-between;align-items:center;gap:6px">
      <span id="assign_label_${nameKey}" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${display}</span>
      <span style="color:var(--gray)">▼</span>
    </div>
    <div id="assign_list_${nameKey}" style="display:none;position:absolute;z-index:100;
      background:var(--bg2);border:1px solid var(--border);border-radius:6px;
      box-shadow:0 4px 12px rgba(0,0,0,0.1);min-width:160px;padding:4px 0">
      ${translators.map(tr => `
        <label style="display:flex;align-items:center;gap:8px;padding:6px 12px;
          cursor:pointer;font-size:12px;white-space:nowrap"
          onmouseover="this.style.background='#e0f2fe'" onmouseout="this.style.background=''">
          <input type="checkbox" value="${tr}" ${assigned.includes(tr)?'checked':''}
            onchange="updateAssignLabel('${nameKey}')">
          ${tr}
        </label>`).join('')}
    </div>
  </div>`;
}

function toggleAssignList(nameKey) {
  var list = document.getElementById('assign_list_' + nameKey);
  list.style.display = list.style.display === 'none' ? 'block' : 'none';
}

function updateAssignLabel(nameKey) {
  var checked = Array.from(
    document.querySelectorAll('#assign_list_' + nameKey + ' input:checked')
  ).map(cb => cb.value);
  var label = document.getElementById('assign_label_' + nameKey);
  label.textContent = checked.length ? checked.join(', ') : '선택...';
}

function getAssignedValues(nameKey) {
  var checkboxes = document.querySelectorAll('#assign_list_' + nameKey + ' input[type=checkbox]:checked');
  return Array.from(checkboxes).map(cb => cb.value).join(',');
}

// 외부 클릭 시 드롭다운 닫기
document.addEventListener('click', function(ev) {
  if (!ev.target.closest('.assign-wrap')) {
    document.querySelectorAll('[id^="assign_list_"]').forEach(function(el) {
      el.style.display = 'none';
    });
  }
});

// changeRole은 saveTeacher로 대체되었으나 하위호환 유지
async function changeRole(name) {
  var nameKey = name.replace(/[^a-zA-Z0-9가-힣]/g, '_');
  await saveTeacher(nameKey, name);
}

function renderAdminTab() {
  loadTeacherList();
}

// ── 관리자: 입력 데이터 초기화 ────────────────────────────────
function openClearDataModal() {
  document.getElementById('clearConfirm').value = '';
  updateClearScopeInfo();
  document.getElementById('clearMode').onchange = updateClearScopeInfo;
  document.getElementById('clearDataOverlay').classList.add('open');
}

function updateClearScopeInfo() {
  var mode = document.getElementById('clearMode').value;
  var info = document.getElementById('clearScopeInfo');
  if (mode === 'all') {
    info.innerHTML = '⚠️ <b style="color:#dc2626">모든 학년도·학기의 번역 데이터</b>가 삭제됩니다.';
  } else {
    var y = document.getElementById('selYear').value;
    var s = document.getElementById('selSem').value;
    info.innerHTML = '→ <b>' + y + '년 ' + s + '학기</b> 데이터만 삭제됩니다.';
  }
}

async function executeClearData() {
  var mode = document.getElementById('clearMode').value;
  var confirmText = document.getElementById('clearConfirm').value.trim();
  if (confirmText !== '삭제') { toast('확인란에 "삭제"를 정확히 입력하세요.', 'error'); return; }

  var filters = null;
  if (mode === 'filter') {
    filters = {
      year:     document.getElementById('selYear').value,
      semester: document.getElementById('selSem').value
    };
  }

  try {
    var res = await API.clearTransData(mode, filters);
    if (res.success) {
      toast(res.deleted + '건 삭제 완료 ✓', 'success');
      closeModal('clearDataOverlay');
      APP.cache.loaded = false; // 캐시 무효화
      // 현재 보고 있던 데이터 비우기
      APP.rows = [];
      APP.cache.transMap = {};
      updateTransBadge();
    } else {
      toast('삭제 실패: ' + res.error, 'error');
    }
  } catch(e) { toast(e.message, 'error'); }
}

// ── 관리자: 과목/동아리 편집 ──────────────────────────────────
var _currData = [];

async function loadCurriculumList() {
  document.getElementById('teacherList').innerHTML = '';
  var wrap = document.getElementById('curriculumList');
  wrap.innerHTML = '<p style="color:var(--gray);padding:10px">불러오는 중...</p>';
  try {
    var res = await API.getCurriculumAll();
    if (!res.success) { toast('로드 실패: ' + res.error, 'error'); return; }
    _currData = res.data;
    renderCurriculumTable();
  } catch(e) { toast(e.message, 'error'); }
}

function renderCurriculumTable() {
  var wrap = document.getElementById('curriculumList');
  var html = '<div class="admin-section"><h4>📖 과목 · 동아리 편집</h4>' +
    '<p style="font-size:11px;color:var(--gray);margin-bottom:10px">담당교사는 쉼표(,)로 구분. 학기1=Q~S, 학기2=T~V 열에 저장됩니다.</p>' +
    '<table class="sheet" style="min-width:100%"><thead><tr>' +
    '<th style="width:5%">학년</th><th style="width:7%">구분</th>' +
    '<th style="width:15%">과목명(KR)</th><th style="width:15%">과목명(EN)</th>' +
    '<th style="width:7%">언어</th>' +
    '<th style="width:17%">담당교사 1학기</th><th style="width:17%">담당교사 2학기</th>' +
    '<th style="width:12%">변경</th></tr></thead><tbody>' +
    _currData.map(function(c, i) {
      return '<tr id="crow_' + i + '">' +
        '<td><div class="ci">' + c.grade + '</div></td>' +
        '<td><div class="ci" style="font-size:11px">' + e(c.type) + '</div></td>' +
        '<td><input class="cedit" id="c_kr_' + i + '" value="' + e(c.nameKR) + '"></td>' +
        '<td><input class="cedit" id="c_en_' + i + '" value="' + e(c.nameEN) + '"></td>' +
        '<td><input class="cedit" id="c_lang_' + i + '" value="' + e(c.language) + '"></td>' +
        '<td><input class="cedit" id="c_t1_' + i + '" value="' + e(c.teachers1) + '"></td>' +
        '<td><input class="cedit" id="c_t2_' + i + '" value="' + e(c.teachers2) + '"></td>' +
        '<td class="ca"><div style="display:flex;gap:4px">' +
          '<button class="btn-tr" onclick="saveCurriculum(' + i + ')" style="flex:1">저장</button>' +
          '<button class="btn-cp" onclick="deleteCurriculumRow(' + i + ')" ' +
            'style="flex:1;background:#fee2e2;border-color:#fca5a5;color:var(--red)">삭제</button>' +
        '</div></td>' +
      '</tr>';
    }).join('') +
    '</tbody></table>' +

    // 신규 추가 폼
    '<div style="margin-top:16px;padding:14px;background:var(--bg3);border-radius:8px">' +
    '<div style="font-size:13px;font-weight:600;margin-bottom:10px">➕ 새 과목/동아리 추가</div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end">' +
    '<div><div class="flabel">학년</div><input class="finput" id="nc_grade" style="width:60px" placeholder="7"></div>' +
    '<div><div class="flabel">구분</div><select class="finput" id="nc_type" style="width:90px">' +
      '<option value="과목">과목</option><option value="동아리">동아리</option></select></div>' +
    '<div><div class="flabel">과목명(KR)</div><input class="finput" id="nc_kr" style="width:140px"></div>' +
    '<div><div class="flabel">과목명(EN)</div><input class="finput" id="nc_en" style="width:140px"></div>' +
    '<div><div class="flabel">언어</div><input class="finput" id="nc_lang" style="width:70px" placeholder="English"></div>' +
    '<div><div class="flabel">담당교사 1학기</div><input class="finput" id="nc_t1" style="width:140px" placeholder="이름,이름"></div>' +
    '<div><div class="flabel">담당교사 2학기</div><input class="finput" id="nc_t2" style="width:140px"></div>' +
    '<button class="btn-teal" onclick="addCurriculumRow()">추가</button>' +
    '</div></div>' +
    '</div>';
  wrap.innerHTML = html;
}

async function addCurriculumRow() {
  var fields = {
    grade:     document.getElementById('nc_grade').value.trim(),
    type:      document.getElementById('nc_type').value,
    nameKR:    document.getElementById('nc_kr').value.trim(),
    nameEN:    document.getElementById('nc_en').value.trim(),
    language:  document.getElementById('nc_lang').value.trim(),
    teachers1: document.getElementById('nc_t1').value.trim(),
    teachers2: document.getElementById('nc_t2').value.trim()
  };
  if (!fields.nameKR) { toast('과목명(KR)은 필수입니다.', 'error'); return; }
  try {
    var res = await API.addCurriculum(fields);
    if (res.success) {
      toast('추가 완료 ✓', 'success');
      APP.cache.loaded = false;
      loadCurriculumList();
    } else toast('추가 실패: ' + res.error, 'error');
  } catch(e) { toast(e.message, 'error'); }
}

async function deleteCurriculumRow(i) {
  var c = _currData[i];
  if (!confirm('[' + c.nameKR + '] 과목을 삭제하시겠습니까?')) return;
  try {
    var res = await API.deleteCurriculum(c.rowIndex);
    if (res.success) {
      toast('삭제 완료 ✓', 'success');
      APP.cache.loaded = false;
      loadCurriculumList();
    } else toast('삭제 실패: ' + res.error, 'error');
  } catch(e) { toast(e.message, 'error'); }
}

async function saveCurriculum(i) {
  var c = _currData[i];
  var fields = {
    nameKR:    document.getElementById('c_kr_' + i).value.trim(),
    nameEN:    document.getElementById('c_en_' + i).value.trim(),
    language:  document.getElementById('c_lang_' + i).value.trim(),
    teachers1: document.getElementById('c_t1_' + i).value.trim(),
    teachers2: document.getElementById('c_t2_' + i).value.trim()
  };
  try {
    var res = await API.updateCurriculum(c.rowIndex, fields);
    if (res.success) {
      toast(c.nameKR + ' 저장 완료 ✓', 'success');
      APP.cache.loaded = false; // 과목 변경 → 캐시 무효화
    } else toast('저장 실패: ' + res.error, 'error');
  } catch(e) { toast(e.message, 'error'); }
}

// ── 엔진·프롬프트 설정 모달 ──────────────────────────────────
async function openSettingsModal() {
  // 항상 최신 설정 로드
  try {
    var res = await API.getSettings();
    if (res && res.success) {
      APP.settings = res.data;
      mergeCustomModels(res.data.customModels); // 커스텀 모델 병합
    }
  } catch(e) {}
  var s = APP.settings || {};
  document.getElementById('setEngine').value = s.engine || 'claude';
  onSetEngineChange();
  document.getElementById('setModel').value  = s.model || 'claude-opus-4-8';
  document.getElementById('setCreat').value  = s.creativity || '0.3';
  document.getElementById('setStep1').value  = s.step1_prompt || '';
  document.getElementById('setStep2').value  = s.step2_prompt || '';
  document.getElementById('settingsOverlay').classList.add('open');
}

async function resetSettingsDefault() {
  if (!confirm('엔진·프롬프트·용어·예시를 모두 기본값으로 되돌립니다. 계속하시겠습니까?')) return;
  try {
    var res = await API.resetSettings();
    if (res.success) {
      toast('기본값 복원 완료 ✓', 'success');
      var s = await API.getSettings();
      if (s.success) APP.settings = s.data;
      closeModal('settingsOverlay');
      openSettingsModal();
    } else toast('복원 실패: ' + res.error, 'error');
  } catch(e) { toast(e.message, 'error'); }
}

function onSetEngineChange() {
  var engine = document.getElementById('setEngine').value;
  var sel = document.getElementById('setModel');
  sel.innerHTML = (APP.models[engine] || []).map(function(m) {
    return '<option value="' + m + '">' + m + '</option>';
  }).join('');
}

function mergeCustomModels(custom) {
  if (!custom) return;
  ['claude','gpt','gemini','google'].forEach(function(eng) {
    if (custom[eng] && custom[eng].length) {
      custom[eng].forEach(function(m) {
        if (APP.models[eng].indexOf(m) === -1) APP.models[eng].push(m);
      });
    }
  });
}

// 현재 커스텀 모델만 추출 (기본 모델 제외)
var BASE_MODELS = {
  claude: ['claude-opus-4-8','claude-opus-4-6','claude-sonnet-4-6','claude-haiku-4-5-20251001'],
  gpt:    ['gpt-4o','gpt-4o-mini','gpt-4-turbo','gpt-3.5-turbo'],
  gemini: ['gemini-2.5-flash','gemini-2.5-pro','gemini-2.0-flash'],
  google: ['google-translate']
};

function getCustomModels() {
  var custom = {};
  ['claude','gpt','gemini','google'].forEach(function(eng) {
    custom[eng] = APP.models[eng].filter(function(m) {
      return BASE_MODELS[eng].indexOf(m) === -1;
    });
  });
  return custom;
}

async function addCustomModel() {
  var engine = document.getElementById('setEngine').value;
  var name = prompt('추가할 ' + engine + ' 모델명을 입력하세요\n(예: claude-opus-4-9, gpt-5)');
  if (!name) return;
  name = name.trim();
  if (!name) return;
  if (APP.models[engine].indexOf(name) !== -1) { toast('이미 존재하는 모델입니다.', 'error'); return; }
  APP.models[engine].push(name);
  onSetEngineChange();
  document.getElementById('setModel').value = name;
  // 즉시 저장 + 상단바 드롭다운 갱신
  await persistCustomModels();
  refreshToolbarModels();
  toast('모델 추가·저장됨 ✓', 'success');
}

async function removeCustomModel() {
  var engine = document.getElementById('setEngine').value;
  var model  = document.getElementById('setModel').value;
  if (BASE_MODELS[engine].indexOf(model) !== -1) {
    toast('기본 모델은 삭제할 수 없습니다.', 'error'); return;
  }
  var idx = APP.models[engine].indexOf(model);
  if (idx !== -1) {
    APP.models[engine].splice(idx, 1);
    onSetEngineChange();
    await persistCustomModels();
    refreshToolbarModels();
    toast('모델 삭제·저장됨 ✓', 'success');
  }
}

// 커스텀 모델만 시트에 저장
async function persistCustomModels() {
  try {
    await API.saveSettings({ customModels: getCustomModels() });
    if (APP.settings) APP.settings.customModels = getCustomModels();
  } catch(e) { toast('모델 저장 실패: ' + e.message, 'error'); }
}

// 상단바(번역 탭) 모델 드롭다운 갱신
function refreshToolbarModels() {
  var topEngine = document.getElementById('selEngine');
  var topModel  = document.getElementById('selModel');
  if (!topEngine || !topModel) return;
  var cur = topModel.value;
  // 상단바 엔진의 현재 모델 목록 다시 채움
  topModel.innerHTML = (APP.models[topEngine.value] || []).map(function(m) {
    return '<option value="' + m + '">' + m + '</option>';
  }).join('');
  if (cur && APP.models[topEngine.value].indexOf(cur) !== -1) topModel.value = cur;
}

async function saveSettingsModal() {
  var data = {
    engine:       document.getElementById('setEngine').value,
    model:        document.getElementById('setModel').value,
    creativity:   document.getElementById('setCreat').value,
    step1_prompt: document.getElementById('setStep1').value,
    step2_prompt: document.getElementById('setStep2').value,
    customModels: getCustomModels()
  };
  try {
    var res = await API.saveSettings(data);
    if (res.success) {
      toast('설정 저장 완료 ✓', 'success');
      closeModal('settingsOverlay');
      loadSettings();
    } else toast('저장 실패: ' + res.error, 'error');
  } catch(e) { toast(e.message, 'error'); }
}

// ── 용어·예시 모달 ──────────────────────────────────────────
async function openRefModal() {
  try {
    var res = await API.getSettings();
    if (res && res.success) APP.settings = res.data;
  } catch(e) {}
  var s = APP.settings || {};
  document.getElementById('setTerms').value = s.terms || '';
  document.getElementById('setExamples').value = (s.examples || []).join('\n\n');
  document.getElementById('refOverlay').classList.add('open');
}

async function saveRefModal() {
  var terms = document.getElementById('setTerms').value;
  var examplesRaw = document.getElementById('setExamples').value;
  // 빈 줄 2개로 예시 분리
  var examples = examplesRaw.split(/\n\s*\n/).map(function(s){return s.trim();}).filter(Boolean);
  try {
    var res = await API.saveSettings({ terms: terms, examples: examples });
    if (res.success) {
      toast('용어·예시 저장 완료 ✓', 'success');
      closeModal('refOverlay');
      loadSettings();
    } else toast('저장 실패: ' + res.error, 'error');
  } catch(e) { toast(e.message, 'error'); }
}

function openApiModal() { document.getElementById('apiOverlay').classList.add('open'); checkApiKeysStatus(); }

async function saveApiKeys() {
  var oai = document.getElementById('oaiKey').value;
  var ant = document.getElementById('antKey').value;
  var gem = document.getElementById('gemKey') ? document.getElementById('gemKey').value : '';
  try {
    var res = await API.saveApiKeys(oai, ant, gem);
    if (res.success) {
      toast('API 키 저장 완료 ✓', 'success');
      checkApiKeysStatus(); // 저장 직후 확인
    } else toast('저장 실패', 'error');
  } catch(e) { toast(e.message, 'error'); }
}

async function checkApiKeysStatus() {
  try {
    var res = await API.checkApiKeys();
    if (res.success) {
      var d = res.data;
      var el = document.getElementById('apiKeyStatus');
      if (el) el.innerHTML =
        '<div style="margin-top:10px;padding:10px;background:var(--bg3);border-radius:6px;font-size:11px;line-height:1.8">' +
        '<b>저장 상태:</b><br>' +
        'OpenAI: ' + e(d.openai) + '<br>' +
        'Anthropic: ' + e(d.anthropic) + '<br>' +
        'Gemini: ' + e(d.gemini) + '</div>';
    }
  } catch(err) {}
}

// ── URL 모달 ─────────────────────────────────────────────────
function openUrlModal() {
  var cur = Config.get();
  document.getElementById('curUrl').textContent = cur || '(없음)';
  document.getElementById('newUrl').value = cur;
  document.getElementById('urlOverlay').classList.add('open');
}
function saveUrl() {
  var val = document.getElementById('newUrl').value.trim();
  if (!val.startsWith('https://script.google.com')) { toast('올바른 URL이 아닙니다.', 'error'); return; }
  Config.set(val);
  toast('저장 완료. 새로고침...', 'success');
  setTimeout(() => location.reload(), 800);
}
function resetUrl() {
  if (!confirm('URL을 초기화하고 로그인 페이지로 이동합니까?')) return;
  Config.clear(); Auth.clear();
  window.location.href = 'index.html';
}

// ── 유틸 ────────────────────────────────────────────────────
function buildStatusBadge(r, idx) {
  // 저장 안 됨
  if (!r.rowIndex) {
    // AI 번역됐지만 아직 저장 안 함
    if (r.status === 'ai_draft' && r.finalText) {
      return '<span class="sbadge" style="background:#fef3c7;color:#92400e">AI초안</span>' +
        '<div style="font-size:9px;color:var(--red);font-weight:700;margin-top:2px">● 미저장</div>';
    }
    return '<div style="font-size:10px;font-weight:700;color:var(--red)">● 미저장</div>';
  }
  // 저장됨 + 미수정
  if (!r._dirty) {
    var label = r.status === 'reviewed' ? '검수완료'
              : r.status === 'ai_draft' ? 'AI초안'
              : r.status === 'final'    ? '최종완료'
              : '저장됨';
    var cls   = r.status === 'reviewed' ? 's-reviewed'
              : r.status === 'final'    ? 's-final'
              : 's-draft';
    var style = r.status === 'ai_draft' ? ' style="background:#fef3c7;color:#92400e"' : '';
    var badge = '<span class="sbadge ' + cls + '"' + style + '>' + label + '</span>';
    // AI초안이면 "검수확정" 안내
    if (r.status === 'ai_draft') {
      badge += '<div style="font-size:9px;color:var(--gray);margin-top:2px">저장=검수확정</div>';
    }
    // 검수완료/최종완료면 복사 버튼 노출
    if ((r.status === 'reviewed' || r.status === 'final') && idx !== undefined) {
      badge += '<button class="btn-cp" onclick="copyFinal(' + idx + ')" ' +
        'style="margin-top:4px;width:100%;background:#dcfce7;' +
        'border-color:#86efac;color:#166534;font-weight:600">📋 복사</button>';
    }
    return badge;
  }
  // 저장됨 + 수정됨
  return '<span class="sbadge s-draft">수정중</span>' +
    '<div style="font-size:9px;color:var(--gold);font-weight:700;margin-top:2px">● 미저장</div>';
}

function showNeisHelp() {
  var overlay = document.getElementById('neisHelpOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'neisHelpOverlay';
    overlay.className = 'overlay open';
    overlay.innerHTML = `
      <div class="modal" style="max-width:460px">
        <button class="modal-x" onclick="document.getElementById('neisHelpOverlay').classList.remove('open')">×</button>
        <h3>🔍 NEIS 검토 항목</h3>
        <div style="margin-top:12px;font-size:12px;line-height:2;color:var(--text)">
          <div style="padding:8px 12px;background:var(--bg3);border-radius:6px;margin-bottom:8px">
            <b>📏 글자수</b> — 500자 초과 여부 확인
          </div>
          <div style="padding:8px 12px;background:var(--bg3);border-radius:6px;margin-bottom:8px">
            <b>🚫 금칙 특수문자</b> — NEIS 입력 불가 문자<br>
            <span style="font-family:monospace;color:var(--red)">&lt; &gt; { } [ ] \ | ^ ~ \`</span>
          </div>
          <div style="padding:8px 12px;background:var(--bg3);border-radius:6px;margin-bottom:8px">
            <b>✍️ 문장 종결</b> — ~함. ~임. ~됨. ~있음. 등 권장
          </div>
          <div style="padding:8px 12px;background:var(--bg3);border-radius:6px">
            <b>🔁 중복 표현</b> — 동일 단어 3회 이상 반복 감지
          </div>
        </div>
        <div class="mfooter">
          <button class="btn-save" onclick="document.getElementById('neisHelpOverlay').classList.remove('open')">확인</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
  } else {
    overlay.classList.add('open');
  }
}

function showApiKeyAlert(msg) {
  var overlay = document.getElementById('apiKeyAlertOverlay');
  var msgEl   = document.getElementById('apiKeyAlertMsg');
  if (!overlay) {
    // 동적 생성
    overlay = document.createElement('div');
    overlay.id = 'apiKeyAlertOverlay';
    overlay.className = 'overlay open';
    overlay.innerHTML = `
      <div class="modal" style="max-width:420px;text-align:center">
        <div style="font-size:32px;margin-bottom:12px">🔑</div>
        <h3 style="margin-bottom:10px">API 키 필요 / API Key Required</h3>
        <p id="apiKeyAlertMsg" style="margin-bottom:20px;font-size:13px;color:var(--text)"></p>
        <div style="display:flex;gap:8px;justify-content:center">
          <button class="btn-cancel" onclick="document.getElementById('apiKeyAlertOverlay').classList.remove('open')">닫기</button>
          <button class="btn-save" onclick="document.getElementById('apiKeyAlertOverlay').classList.remove('open');openApiModal()">
            API 키 설정하기
          </button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
  } else {
    overlay.classList.add('open');
  }
  document.getElementById('apiKeyAlertMsg').textContent = msg;
}

async function openPromptModal() {
  // 최신 관리자 설정 로드
  try {
    var res = await API.getSettings();
    if (res && res.success) APP.settings = res.data;
  } catch(e) {}
  var s = APP.settings || {};
  document.getElementById('viewStep1').value = s.step1_prompt || '';
  document.getElementById('viewStep2').value = s.step2_prompt || '';
  document.getElementById('viewTerms').value = s.terms || '';
  document.getElementById('promptOverlay').classList.add('open');
}
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

function copyFinal(i) {
  var txt = APP.rows[i].finalText || APP.rows[i].translatedDraft;
  if (!txt) { toast('복사할 텍스트가 없습니다.', 'error'); return; }
  copyToClipboard(txt);
  toast('최종본 복사 완료 ✓', 'success');
}

function copyText(i, type) {
  var txt = type === 'final'
    ? (APP.rows[i].finalText || APP.rows[i].translatedDraft)
    : APP.rows[i].translatedDraft;
  if (!txt) { toast('복사할 텍스트가 없습니다.', 'error'); return; }
  copyToClipboard(txt);
  toast('클립보드 복사 완료 ✓', 'success');
}
function copyToClipboard(txt) {
  navigator.clipboard?.writeText(txt).catch(() => {
    var ta = document.createElement('textarea');
    ta.value = txt; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
  });
}

function showLoading(msg) {
  document.getElementById('loading').style.display = 'flex';
  var lt = document.querySelector('.loading-text');
  if (lt) lt.textContent = msg || '불러오는 중...';
}
function hideLoading() { document.getElementById('loading').style.display = 'none'; }

var _tt;
function toast(msg, type) {
  var el = document.getElementById('toast');
  el.textContent = msg; el.className = 'show ' + (type||'');
  clearTimeout(_tt); _tt = setTimeout(() => el.className = '', 3000);
}

// XSS 방지
function e(s) {
  return String(s||'')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

function doLogout() {
  Auth.clear();
  window.location.href = 'index.html';
}
