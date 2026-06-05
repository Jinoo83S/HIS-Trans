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
      // GAS CORS: text/plain → preflight(OPTIONS) 없이 simple request로 전송
      // GAS는 CORS 헤더를 응답에 추가하지 않으므로 no-cors 대신
      // "누구나 액세스" 배포 + text/plain 조합이 유일한 해결책
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      redirect: 'follow',
      body: JSON.stringify(body)
    });

    if (!res.ok) throw new Error('HTTP ' + res.status);

    var data = await res.json();
    if (data && data.error === 'unauthorized') {
      Auth.clear();
      // 이미 로그인 페이지면 리다이렉트 안 함 (무한루프 방지)
      var p = window.location.pathname;
      if (p.endsWith('app.html')) {
        window.location.href = 'index.html';
      }
      return;
    }
    return data;
  }

  return {
    call,  // 직접 호출용 (토큰 불필요 액션)
    getInitialData: (year, semester) => call('getInitialData', { year, semester }),
    // 인증
    login:              (name, pw)              => call('login', { name, password: pw }),

    // 교사
    getMe:              ()                      => call('getMe'),
    getTeachers:        ()                      => call('getTeachers'),
    updateTeacherRole:  (name, role, assigned)   => call('updateTeacherRole', { name, role, assigned }),
    addTeacher:         (teacher)               => call('addTeacher', { teacher }),

    // 과목/학생
    getMySubjects:      (semester)              => call('getMySubjects', { semester }),
    getAllSubjects:      (semester)              => call('getAllSubjects', { semester }),
    getReviewerSubjects:(semester)              => call('getReviewerSubjects', { semester }),
    getStudentsByCourse:(subjectCode, isClub, semester) => call('getStudentsByCourse', { subjectCode, isClub, semester }),

    // 번역
    translate:          (payload)               => call('translate', { payload }),
    runPipeline:        (payload)               => call('runPipeline', { payload }),
    getSettings:        ()                      => call('getSettings'),
    saveSettings:       (data)                  => call('saveSettings', { data }),
    resetSettings:      ()                      => call('resetSettings'),
    getCurriculumAll:   ()                      => call('getCurriculumAll'),
    updateCurriculum:   (rowIndex, fields)      => call('updateCurriculum', { rowIndex, fields }),
    addCurriculum:      (fields)                => call('addCurriculum', { fields }),
    deleteCurriculum:   (rowIndex)              => call('deleteCurriculum', { rowIndex }),
    deleteTeacher:      (teacherName)           => call('deleteTeacher', { teacherName }),
    clearTransData:     (mode, filters)         => call('clearTransData', { mode, filters }),

    // 저장/조회
    saveTrans:          (record)                => call('saveTrans', { record }),
    getTransList:       (filters)               => call('getTransList', { filters }),
    getTransHistory:    (filters)               => call('getTransHistory', { filters }),
    updateTrans:        (rowIndex, fields)       => call('updateTrans', { rowIndex, fields }),

    // NEIS
    neisValidate:       (text)                  => call('neisValidate', { text }),
    spellCheck:         (text)                  => call('spellCheck', { text }),
    suggestNeisStyle:   (text, model, engine)   => call('suggestNeisStyle', { text, model, engine }),

    // 관리자
    saveApiKeys:        (openai, anthropic, gemini) => call('saveApiKeys', { openaiKey: openai, anthropicKey: anthropic, geminiKey: gemini }),
    checkApiKeys:       ()                      => call('checkApiKeys'),
    deleteApiKey:       (which)                 => call('deleteApiKey', { which }),
    getTokenStats:      (filters)               => call('getTokenStats', { filters }),
    clearTokenStats:    ()                      => call('clearTokenStats'),
    getModels:          ()                      => call('getModels'),
  };
})();
