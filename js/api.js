// ============================================================
// api.js — GAS API 호출 모듈
// fetch() → GAS doPost() → JSON 응답
// ============================================================

var API = (function() {

  async function call(action, params) {
    var url = Config.get();
    if (!url) throw new Error('GAS URL이 설정되지 않았습니다.');

    var token = Auth.getToken();

    var body = Object.assign({ action, token }, params || {});

    var res = await fetch(url, {
      method: 'POST',
      // GAS CORS: content-type을 text/plain으로 해야 preflight 없음
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(body)
    });

    if (!res.ok) throw new Error('HTTP ' + res.status);

    var data = await res.json();
    if (data && data.error === 'unauthorized') {
      Auth.clear();
      window.location.href = 'login.html';
      return;
    }
    return data;
  }

  return {
    // 인증
    login:              (name, pw)              => call('login', { name, password: pw }),

    // 교사
    getMe:              ()                      => call('getMe'),
    getTeachers:        ()                      => call('getTeachers'),
    updateTeacherRole:  (name, role)            => call('updateTeacherRole', { name, role }),

    // 과목/학생
    getMySubjects:      (semester)              => call('getMySubjects', { semester }),
    getStudentsByCourse:(subjectCode)           => call('getStudentsByCourse', { subjectCode }),

    // 번역
    translate:          (payload)               => call('translate', { payload }),

    // 저장/조회
    saveTrans:          (record)                => call('saveTrans', { record }),
    getTransList:       (filters)               => call('getTransList', { filters }),
    updateTrans:        (rowIndex, fields)       => call('updateTrans', { rowIndex, fields }),

    // NEIS
    neisValidate:       (text)                  => call('neisValidate', { text }),
    spellCheck:         (text)                  => call('spellCheck', { text }),
    suggestNeisStyle:   (text, model, engine)   => call('suggestNeisStyle', { text, model, engine }),

    // 관리자
    saveApiKeys:        (openai, anthropic)     => call('saveApiKeys', { openaiKey: openai, anthropicKey: anthropic }),
    getModels:          ()                      => call('getModels'),
  };
})();
