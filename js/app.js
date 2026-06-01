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
    claude: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001']
  }
};

// ── 초기화 ──────────────────────────────────────────────────
window.onload = async function() {
  if (!Config.isSet()) { window.location.href = 'login.html'; return; }
  if (!Auth.isLoggedIn()) { window.location.href = 'login.html'; return; }

  try {
    var res = await API.getMe();
    if (!res || !res.success) { Auth.clear(); window.location.href = 'login.html'; return; }
    APP.teacher = res.data;
    initUI();
  } catch(e) {
    // 네트워크 오류 시 캐시된 교사 정보 사용
    APP.teacher = Auth.getTeacher();
    if (!APP.teacher) { window.location.href = 'login.html'; return; }
    initUI();
  }
};

function initUI() {
  var t = APP.teacher;
  document.getElementById('tName').textContent = t.name + ' / ' + t.fullName;
  var rb = document.getElementById('rBadge');
  rb.textContent = t.role;
  rb.className = 'role-badge role-' + t.role;

  if (t.role === '관리자') document.getElementById('navAdmin').style.display = '';

  // 학년도 옵션
  var now = new Date(), curY = now.getFullYear();
  var ys = document.getElementById('selYear');
  for (var y = curY; y >= curY - 3; y--) {
    var o = document.createElement('option');
    o.value = o.textContent = y; ys.appendChild(o);
  }
  document.getElementById('selSem').value = (now.getMonth() + 1) <= 7 ? '1' : '2';

  onEngineChange();
  loadSubjects();
  hideLoading();
}

// ── 과목 목록 ────────────────────────────────────────────────
async function loadSubjects() {
  var sem = document.getElementById('selSem').value;
  var isAdmin = APP.teacher && APP.teacher.role === '관리자';
  try {
    var res = isAdmin
      ? await API.getAllSubjects(sem)
      : await API.getMySubjects(sem);
    if (!res.success) { toast('과목 로드 실패', 'error'); return; }
    APP.subjects = res.data;
    renderSubjectSelect();
  } catch(e) { toast('오류: ' + e.message, 'error'); }
}

function renderSubjectSelect() {
  var sel = document.getElementById('selSubject');
  var grade = document.getElementById('selGrade').value;
  var tab = APP.currentTab;

  var filtered = APP.subjects.filter(s =>
    s.type === tab && (!grade || String(s.grade) === grade)
  );

  var isAdmin = APP.teacher && APP.teacher.role === '관리자';
  sel.innerHTML = '<option value="">-- ' +
    (tab === '과목' ? '과목 선택' : '동아리 선택') + ' --</option>' +
    filtered.map(s => {
      var teacherInfo = isAdmin && s.teachers && s.teachers.length
        ? ' [' + s.teachers.join(', ') + ']' : '';
      return `<option value="${s.subjectCode}" data-s='${JSON.stringify(s)}'>` +
        `G${s.grade} | ${s.nameKR} / ${s.nameEN}${teacherInfo}</option>`;
    }).join('');
}

async function onSubjectChange() {
  var sel = document.getElementById('selSubject');
  var opt = sel.options[sel.selectedIndex];
  if (!opt || !opt.dataset.s) { APP.selectedSubject = null; showEmptyTrans(); return; }

  APP.selectedSubject = JSON.parse(opt.dataset.s);
  showLoading('학생 목록 불러오는 중...');

  try {
    var res = await API.getStudentsByCourse(APP.selectedSubject.subjectCode);
    hideLoading();
    if (!res.success) { toast('학생 로드 실패', 'error'); return; }

    APP.rows = res.data.map(s => ({
      student: s, sourceText: '', translatedDraft: '',
      finalText: '', comment: '', status: 'draft',
      rowIndex: null, translating: false
    }));
    renderTable();
  } catch(e) { hideLoading(); toast(e.message, 'error'); }
}

function onFilterChange() { loadSubjects(); }

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

  var isTrans = role === '번역';

  head.innerHTML = '<tr>' +
    '<th style="min-width:90px">Name (EN)</th>' +
    '<th style="min-width:70px">이름</th>' +
    '<th>Gr.</th><th>Cls.</th><th>NEIS</th>' +
    '<th class="ths" style="min-width:260px">Source (원문)</th>' +
    '<th style="min-width:70px">번역</th>' +
    '<th class="tht" style="min-width:240px">번역 초본</th>' +
    (!isTrans ? '<th class="thf" style="min-width:240px">최종본</th>' : '') +
    (!isTrans ? '<th style="min-width:130px">검수 코멘트</th>' : '') +
    '<th>글자수</th><th style="min-width:80px">상태</th>' +
    '</tr>';

  body.innerHTML = APP.rows.map((r, i) => rowHtml(r, i, role)).join('');
}

function rowHtml(r, i, role) {
  var s = r.student;
  var txt = r.finalText || r.translatedDraft || '';
  var cc = txt.length;
  var ccCls = cc === 0 ? '' : cc > 500 ? 'cc-over' : cc > 450 ? 'cc-warn' : 'cc-ok';
  var isTrans = role === '번역';

  return `<tr id="row_${i}">
    <td><div class="ci">${e(s.engName||'-')}</div></td>
    <td><div class="ci">${e(s.name)}</div></td>
    <td><div class="ci">${s.grade}</div></td>
    <td><div class="ci">${s.class}</div></td>
    <td><div class="ci ci-neis">${e(s.neisClass||'')}</div></td>
    <td><textarea class="cta src" oninput="APP.rows[${i}].sourceText=this.value"
      ${role==='검수'?'readonly':''}>${e(r.sourceText)}</textarea></td>
    <td class="ca">
      <button class="btn-tr" onclick="translateRow(${i})" ${r.translating?'disabled':''}>
        ${r.translating?'..':'번역'}</button>
      <button class="btn-cp" onclick="copyText(${i},'draft')">복사</button>
    </td>
    <td><textarea class="cta drft" oninput="onDraftChange(${i},this.value)"
      ${isTrans?'readonly':''}>${e(r.translatedDraft)}</textarea></td>
    ${!isTrans ? `
    <td><textarea class="cta fnl" oninput="onFinalChange(${i},this.value)">${e(r.finalText)}</textarea>
      <div class="ca">
        <button class="btn-cp" onclick="copyText(${i},'final')">NEIS 복사</button>
        <button class="btn-cp" onclick="checkNeis(${i})" style="margin-top:2px">NEIS 검토</button>
      </div>
    </td>
    <td><textarea class="cta cmt" oninput="APP.rows[${i}].comment=this.value">${e(r.comment)}</textarea></td>
    ` : ''}
    <td><div class="cc ${ccCls}">${cc>0?cc+'/500':'-'}</div></td>
    <td><div class="ci">
      <span class="sbadge s-${r.status}">${r.status}</span><br>
      <button class="btn-cp" onclick="saveRow(${i})" style="margin-top:4px">저장</button>
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
}

function showEmptyTrans() {
  document.getElementById('mainTable').style.display = 'none';
  document.getElementById('emptyTrans').style.display = 'block';
}

// ── 이벤트 ──────────────────────────────────────────────────
function onDraftChange(i, val) {
  APP.rows[i].translatedDraft = val;
  updateCC(i);
}
function onFinalChange(i, val) {
  APP.rows[i].finalText = val;
  updateCC(i);
}
function updateCC(i) {
  var txt = APP.rows[i].finalText || APP.rows[i].translatedDraft || '';
  var cc = txt.length;
  var el = document.querySelector('#row_' + i + ' .cc');
  if (!el) return;
  var cls = cc === 0 ? '' : cc > 500 ? 'cc-over' : cc > 450 ? 'cc-warn' : 'cc-ok';
  el.textContent = cc > 0 ? cc + '/500' : '-';
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
  sel.innerHTML = APP.models[engine].map(m => `<option value="${m}">${m}</option>`).join('');
}

function setView(btn) {
  var view = btn.dataset.view;
  APP.currentView = view;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('vTranslate').style.display = view === 'translate' ? '' : 'none';
  document.getElementById('vReview').style.display    = view === 'review' ? '' : 'none';
  document.getElementById('vAdmin').style.display     = view === 'admin' ? '' : 'none';
  if (view === 'review') loadReviewList();
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
    if (!res.success) { toast('번역 실패: ' + res.error, 'error'); }
    else {
      row.translatedDraft = res.text;
      if (!row.finalText) row.finalText = res.text;
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
async function saveRow(i) {
  var row = APP.rows[i];
  var s = APP.selectedSubject;
  if (!s) { toast('과목을 선택하세요.', 'error'); return; }

  var record = {
    year: document.getElementById('selYear').value,
    semester: document.getElementById('selSem').value,
    type: APP.currentTab,
    subjectCode: s.subjectCode, subjectNameKR: s.nameKR, subjectNameEN: s.nameEN,
    studentName: row.student.name, studentNameEN: row.student.engName,
    grade: row.student.grade, class: row.student.class,
    neisClass: row.student.neisClass, neisNo: row.student.neisNo,
    sourceLang: document.getElementById('selSrc').value,
    targetLang: document.getElementById('selTgt').value,
    model: document.getElementById('selModel').value,
    creativity: document.getElementById('slCreat').value,
    prompt: APP.prompt,
    sourceText: row.sourceText, translatedDraft: row.translatedDraft
  };

  try {
    var res = await API.saveTrans(record);
    if (res.success) { row.rowIndex = res.rowIndex; toast('저장 완료 ✓', 'success'); }
    else toast('저장 실패: ' + res.error, 'error');
  } catch(e) { toast(e.message, 'error'); }
}

// ── NEIS 검토 ────────────────────────────────────────────────
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
  showLoading('검수 목록 불러오는 중...');
  var filters = {
    year: document.getElementById('selYear').value,
    semester: document.getElementById('selSem').value
  };
  try {
    var res = await API.getTransList(filters);
    hideLoading();
    renderReviewTable(res.data || []);
  } catch(e) { hideLoading(); toast(e.message, 'error'); }
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

// ── 관리 뷰 ─────────────────────────────────────────────────
async function loadTeacherList() {
  try {
    var res = await API.getTeachers();
    if (!res.success) { toast('로드 실패', 'error'); return; }
    document.getElementById('teacherList').innerHTML =
      '<table class="sheet"><thead><tr>' +
      '<th>이름</th><th>Full Name</th><th>이메일</th><th>홈룸</th><th>현재 권한</th><th>변경</th>' +
      '</tr></thead><tbody>' +
      res.data.map(t => `<tr>
        <td><div class="ci">${e(t.name)}</div></td>
        <td><div class="ci">${e(t.fullName)}</div></td>
        <td><div class="ci" style="font-size:11px">${e(t.email)}</div></td>
        <td><div class="ci">${e(t.homeroom)}</div></td>
        <td><div class="ci"><span class="role-badge role-${t.role}">${t.role}</span></div></td>
        <td class="ca">
          <select id="role_${t.name}" style="background:rgba(255,255,255,0.06);border:1px solid var(--border);
            color:var(--white);font-size:11px;padding:4px;border-radius:4px;margin-bottom:4px">
            ${['번역','검수','관리자','일반'].map(r =>
              `<option value="${r}" ${r===t.role?'selected':''}>${r}</option>`).join('')}
          </select><br>
          <button class="btn-tr" onclick="changeRole('${t.name}')">변경</button>
        </td>
      </tr>`).join('') +
      '</tbody></table>';
  } catch(e) { toast(e.message, 'error'); }
}

async function changeRole(name) {
  var role = document.getElementById('role_' + name)?.value;
  try {
    var res = await API.updateTeacherRole(name, role);
    if (res.success) toast(name + ' 권한 변경 완료 ✓', 'success');
    else toast('변경 실패', 'error');
  } catch(e) { toast(e.message, 'error'); }
}

function openApiModal() { document.getElementById('apiOverlay').classList.add('open'); }

async function saveApiKeys() {
  var oai = document.getElementById('oaiKey').value;
  var ant = document.getElementById('antKey').value;
  try {
    var res = await API.saveApiKeys(oai, ant);
    if (res.success) { toast('API 키 저장 완료 ✓', 'success'); closeModal('apiOverlay'); }
    else toast('저장 실패', 'error');
  } catch(e) { toast(e.message, 'error'); }
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
  window.location.href = 'login.html';
}

// ── 유틸 ────────────────────────────────────────────────────
function openPromptModal() {
  document.getElementById('promptText').value = APP.prompt;
  document.getElementById('promptOverlay').classList.add('open');
}
function savePrompt() {
  APP.prompt = document.getElementById('promptText').value;
  closeModal('promptOverlay');
  toast('프롬프트 저장 완료 ✓', 'success');
}
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

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
  window.location.href = 'login.html';
}
