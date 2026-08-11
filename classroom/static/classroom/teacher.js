// teacher.js — Instructor Console, PDF Presentation Deck, Real-Time Laser & Chat Controller

let socket = null;
let wb = null;
let currentRoundAnswers = [];
let currentRoundNumber = 0;
let correctAnswer = null;
let isAnswerRevealed = false;
let activeQuestionType = 'SHORT_ANSWER';
let activeQuizOptions = [];
let connectedStudentsMap = new Map();

let activeChatTab = 'public'; // 'public' or 'private'
let allChatMessages = [];
let studentPrivateStrokesMap = new Map(); // studentName -> array of strokes

document.addEventListener('DOMContentLoaded', () => {
  wb = new WhiteboardEngine('whiteboard-canvas', () => socket, true, 'Instructor (Teacher)');
  initWebSocket();
});

function initWebSocket() {
  const roomCodeElement = document.getElementById('room-code');
  if (!roomCodeElement) return;
  const roomCode = roomCodeElement.innerText.trim();

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws/room/${roomCode}/`;

  updateWsStatus('connecting', 'Connecting...');

  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    updateWsStatus('live', 'Live Connected');
    socket.send(JSON.stringify({ type: 'register_role', role: 'teacher' }));
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleSocketMessage(data);
    } catch (e) {
      console.error('Failed to parse WebSocket message:', e);
    }
  };

  socket.onclose = () => {
    updateWsStatus('connecting', 'Disconnected. Retrying...');
    setTimeout(initWebSocket, 3000);
  };
}

function updateWsStatus(statusClass, labelText) {
  const badge = document.getElementById('ws-status');
  if (!badge) return;
  badge.className = `status-pill status-${statusClass}`;
  badge.innerHTML = `<span class="dot"></span> ${labelText}`;
}

function handleSocketMessage(data) {
  switch (data.type) {
    case 'init_state':
      handleInitState(data);
      break;
    case 'stroke_drawn':
      if (wb && data.student_name !== 'Instructor (Teacher)') {
        wb.addStroke(data.stroke);
      }
      break;
    case 'private_stroke_drawn':
      handlePrivateStrokeDrawn(data);
      break;
    case 'stroke_undone':
      if (wb) wb.undo();
      break;
    case 'whiteboard_cleared':
      if (wb) wb.clearCanvas();
      break;
    case 'slide_changed':
      if (wb) wb.setSlide(data.slide_index, data.total_slides, data.slide_data_url);
      const titleTag = document.getElementById('slide-title-display');
      if (titleTag && data.slide_title) titleTag.innerText = data.slide_title;
      break;
    case 'canvas_mode_changed':
      if (wb) wb.setCanvasMode(data.mode);
      updateCanvasModeUI(data.mode);
      break;
    case 'laser_moved':
      if (wb && data.student_name !== 'Instructor (Teacher)') {
        wb.handleRemoteLaser(data.x, data.y, data.student_name, data.is_teacher, data.active);
      }
      break;
    case 'chat_received':
      renderChatMessage(data.sender_name, data.message, data.is_teacher, data.timestamp, data.is_private, data.recipient_name);
      break;
    case 'permission_updated':
      handlePermissionUpdated(data);
      break;
    case 'question_pushed':
      handleQuestionPushed(data);
      break;
    case 'answer_submitted':
      handleAnswerSubmitted(data);
      break;
    case 'answer_revealed':
      handleAnswerRevealed(data);
      break;
    case 'round_reset':
      handleRoundReset(data);
      break;
    case 'student_joined':
      handleStudentJoined(data);
      break;
  }
}

function handleInitState(data) {
  currentRoundNumber = data.round || 0;
  correctAnswer = data.correct_answer || null;
  isAnswerRevealed = data.is_revealed || false;
  activeQuestionType = data.question_type || 'SHORT_ANSWER';
  activeQuizOptions = data.quiz_options || [];

  const roundBadge = document.getElementById('current-round-badge');
  if (roundBadge) roundBadge.innerText = `Round ${currentRoundNumber}`;

  // Initialize Presentation Slide State & Whiteboard Mode
  if (wb) {
    if (data.strokes) wb.loadStrokes(data.strokes);
    if (data.current_slide_index) wb.setSlide(data.current_slide_index, data.total_slides || 5, data.slide_data_url);
    if (data.canvas_mode) {
      wb.setCanvasMode(data.canvas_mode);
      updateCanvasModeUI(data.canvas_mode);
    }
  }

  // Load Recent Chat Messages
  if (data.recent_chats && Array.isArray(data.recent_chats)) {
    allChatMessages = [];
    data.recent_chats.forEach(c => {
      renderChatMessage(c.sender_name, c.message, c.is_teacher, c.timestamp, c.is_private, c.recipient_name);
    });
  }

  // Sync Student Roster & Permissions
  const approvedSet = new Set(data.approved_students || []);
  if (data.students && Array.isArray(data.students)) {
    data.students.forEach(name => {
      connectedStudentsMap.set(name, { name: name, isApproved: approvedSet.has(name) });
    });
    updateRosterTable();
  }

  if (data.active_question) {
    updateActiveQuestionUI(data.active_question, currentRoundNumber, data.correct_answer, data.is_revealed);
  }
}

function toggleCanvasMode(mode) {
  if (wb) wb.setCanvasMode(mode);
  updateCanvasModeUI(mode);
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: 'set_canvas_mode',
      mode: mode
    }));
  }
}

function updateCanvasModeUI(mode) {
  const btnPdf = document.getElementById('btn-mode-pdf');
  const btnBlank = document.getElementById('btn-mode-blank');
  if (mode === 'blank') {
    if (btnPdf) btnPdf.classList.remove('active');
    if (btnBlank) btnBlank.classList.add('active');
  } else {
    if (btnBlank) btnBlank.classList.remove('active');
    if (btnPdf) btnPdf.classList.add('active');
  }
}

function handlePrivateStrokeDrawn(data) {
  const studentName = data.student_name || 'Anonymous Student';
  if (!studentPrivateStrokesMap.has(studentName)) {
    studentPrivateStrokesMap.set(studentName, []);
  }
  studentPrivateStrokesMap.get(studentName).push(data.stroke);
  
  const badge = document.getElementById('tab-private-count');
  if (badge) badge.innerText = studentPrivateStrokesMap.size;

  renderPrivateSketchesGrid();
}

function renderPrivateSketchesGrid() {
  const grid = document.getElementById('private-sketches-grid');
  if (!grid) return;

  if (studentPrivateStrokesMap.size === 0) {
    grid.innerHTML = `
      <div style="color: var(--text-subtle); font-size: 0.85rem; text-align: center; padding: 2.5rem; grid-column: 1 / -1; background: var(--surface-subtle); border-radius: var(--radius-md); border: 1px dashed var(--border-color);">
        No private student sketches submitted yet. When students use <strong>"Private Draw"</strong> mode, their live sketches will render here!
      </div>
    `;
    return;
  }

  grid.innerHTML = '';
  studentPrivateStrokesMap.forEach((strokes, studentName) => {
    const card = document.createElement('div');
    card.className = 'panel';
    card.style.padding = '0.75rem';
    card.style.border = '1px solid var(--border-color)';
    
    const canvasId = `private-canvas-${studentName.replace(/[^a-zA-Z0-9]/g, '_')}`;
    card.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem;">
        <strong style="font-size: 0.9rem; color: var(--text-main);">🔒 ${escapeHtml(studentName)}</strong>
        <span class="status-pill status-live" style="height: 20px; font-size: 0.65rem;">Private Live</span>
      </div>
      <div style="position: relative; width: 100%; height: 200px; background: #ffffff; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); overflow: hidden;">
        <canvas id="${canvasId}" width="320" height="200" style="width: 100%; height: 100%; display: block;"></canvas>
      </div>
    `;
    grid.appendChild(card);

    setTimeout(() => {
      const cvs = document.getElementById(canvasId);
      if (cvs) {
        const ctx = cvs.getContext('2d');
        ctx.clearRect(0, 0, cvs.width, cvs.height);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, cvs.width, cvs.height);
        strokes.forEach(s => {
          ctx.save();
          if (s.tool === 'pen' || s.tool === 'highlighter' || s.tool === 'eraser') {
            ctx.strokeStyle = s.color || '#0f172a';
            ctx.lineWidth = s.width || 3;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            if (s.points && s.points.length > 0) {
              const scaleX = cvs.width / (wb ? wb.canvas.width : 850);
              const scaleY = cvs.height / (wb ? wb.canvas.height : 540);
              ctx.moveTo(s.points[0].x * scaleX, s.points[0].y * scaleY);
              for (let i = 1; i < s.points.length; i++) {
                ctx.lineTo(s.points[i].x * scaleX, s.points[i].y * scaleY);
              }
              ctx.stroke();
            }
          }
          ctx.restore();
        });
      }
    }, 50);
  });
}

function switchChatTab(tab) {
  activeChatTab = tab;
  const btnPub = document.getElementById('chat-tab-public');
  const btnPriv = document.getElementById('chat-tab-private');

  if (btnPub) {
    btnPub.classList.toggle('active', tab === 'public');
    btnPub.style.background = tab === 'public' ? 'var(--surface-white)' : 'transparent';
    btnPub.style.color = tab === 'public' ? 'var(--primary)' : 'var(--text-muted)';
  }

  if (btnPriv) {
    btnPriv.classList.toggle('active', tab === 'private');
    btnPriv.style.background = tab === 'private' ? 'var(--surface-white)' : 'transparent';
    btnPriv.style.color = tab === 'private' ? 'var(--primary)' : 'var(--text-muted)';
  }

  const dmRow = document.getElementById('dm-recipient-select-row');
  if (dmRow) {
    if (tab === 'private') {
      dmRow.classList.remove('hidden');
    } else {
      dmRow.classList.add('hidden');
    }
  }

  renderAllChatMessages();
}

function sendChatMessage() {
  const input = document.getElementById('chat-input');
  if (!input) return;
  const msg = input.value.trim();
  if (!msg) return;

  const isPrivate = activeChatTab === 'private';
  const recipientSelect = document.getElementById('dm-recipient-select');
  const recipientName = recipientSelect ? recipientSelect.value : 'ALL';

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: 'chat_message',
      sender_name: 'Teacher',
      message: msg,
      is_teacher: true,
      is_private: isPrivate,
      recipient_name: recipientName
    }));
    input.value = '';
  }
}

function renderChatMessage(sender, msg, isTeacher, timestamp, isPrivate = false, recipientName = 'Teacher') {
  allChatMessages.push({ sender, msg, isTeacher, timestamp, isPrivate, recipientName });
  renderAllChatMessages();
}

function renderAllChatMessages() {
  const box = document.getElementById('chat-messages-box');
  if (!box) return;

  box.innerHTML = '';

  const filtered = allChatMessages.filter(c => {
    if (activeChatTab === 'public') {
      return !c.isPrivate;
    } else {
      return c.isPrivate;
    }
  });

  if (filtered.length === 0) {
    box.innerHTML = `
      <div style="color: var(--text-subtle); font-size: 0.8rem; text-align: center; padding: 1.5rem 0;">
        ${activeChatTab === 'public' ? 'Classroom chat started. Messages appear live for all participants!' : 'No private DM messages yet.'}
      </div>
    `;
    return;
  }

  filtered.forEach(c => {
    const isMe = c.sender === 'Teacher' || c.sender === 'Instructor (Teacher)';
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${isMe ? 'me' : ''} ${c.isTeacher ? 'teacher' : ''}`;
    if (c.isPrivate) {
      bubble.style.borderLeft = '3px solid #9333ea';
    }
    
    let tagHtml = c.isTeacher ? '<span class="chat-teacher-badge">INSTRUCTOR</span>' : '';
    if (c.isPrivate) {
      tagHtml += ` <span style="font-size: 0.65rem; background: rgba(147, 51, 234, 0.1); color: #9333ea; padding: 0.05rem 0.35rem; border-radius: 9999px; font-weight: 700;">🔒 DM ${escapeHtml(c.recipientName || 'Teacher')}</span>`;
    }

    bubble.innerHTML = `
      <div class="chat-sender">
        <span>${escapeHtml(c.sender)} ${tagHtml}</span>
        <span class="chat-time">${escapeHtml(c.timestamp || '')}</span>
      </div>
      <div class="chat-text">${escapeHtml(c.msg)}</div>
    `;
    box.appendChild(bubble);
  });
  box.scrollTop = box.scrollHeight;
}

function handleStudentJoined(data) {
  const approvedSet = new Set(data.approved_students || []);
  if (data.students && Array.isArray(data.students)) {
    data.students.forEach(name => {
      connectedStudentsMap.set(name, { name: name, isApproved: approvedSet.has(name) });
    });
    updateRosterTable();
  }
}

function handlePermissionUpdated(data) {
  if (data.student_name && connectedStudentsMap.has(data.student_name)) {
    const student = connectedStudentsMap.get(data.student_name);
    student.isApproved = data.approved;
    updateRosterTable();
  }
}

function updateRosterTable() {
  const tbody = document.getElementById('roster-table-body');
  const statCount = document.getElementById('stat-students');
  const tabBadge = document.getElementById('tab-roster-count');

  const students = Array.from(connectedStudentsMap.values());

  if (statCount) statCount.innerText = students.length;
  if (tabBadge) tabBadge.innerText = students.length;

  const dmSelect = document.getElementById('dm-recipient-select');
  if (dmSelect) {
    const currVal = dmSelect.value;
    dmSelect.innerHTML = `<option value="ALL">All Students (DM Broadcast)</option>` + 
      students.map(s => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`).join('');
    dmSelect.value = currVal;
  }

  if (!tbody) return;

  if (students.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align: center; color: var(--text-subtle); padding: 2rem;">
          No students currently connected to this room.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = students.map(s => `
    <tr>
      <td>
        <strong style="color: var(--text-main);">${escapeHtml(s.name)}</strong>
      </td>
      <td>
        <span class="status-pill ${s.isApproved ? 'status-live' : ''}" style="${!s.isApproved ? 'color: var(--text-subtle); border-color: var(--border-subtle);' : ''}">
          ${s.isApproved ? '✓ Drawing Approved' : '🔒 Read-Only'}
        </span>
      </td>
      <td>
        <span style="color: var(--success); font-size: 0.8rem; font-weight: 600;">Active Online</span>
      </td>
      <td>
        <button onclick="toggleStudentPermission('${escapeJavaScriptString(s.name)}', ${!s.isApproved})" class="btn ${s.isApproved ? 'btn-danger' : 'btn-secondary'} btn-sm">
          ${s.isApproved ? 'Revoke Permission' : 'Grant Draw Permission'}
        </button>
      </td>
    </tr>
  `).join('');
}

function toggleStudentPermission(studentName, approved) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: 'toggle_student_permission',
      student_name: studentName,
      approved: approved
    }));
  }
}

function pushQuestion() {
  const promptInput = document.getElementById('question-text');
  const typeSelect = document.getElementById('quiz-type-select');
  const correctInput = document.getElementById('correct-answer-text');

  const question = promptInput.value.trim();
  const qType = typeSelect.value;
  const correct = correctInput.value.trim();

  if (!question) {
    alert('Please enter a question prompt.');
    return;
  }

  let options = [];
  if (qType === 'MULTIPLE_CHOICE') {
    const optA = document.getElementById('opt-A').value.trim() || 'Option A';
    const optB = document.getElementById('opt-B').value.trim() || 'Option B';
    const optC = document.getElementById('opt-C').value.trim() || 'Option C';
    const optD = document.getElementById('opt-D').value.trim() || 'Option D';
    options = [optA, optB, optC, optD];
  }

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: 'push_question',
      question: question,
      question_type: qType,
      quiz_options: options,
      correct_answer: correct
    }));
  }
}

function revealAnswer() {
  const correctInput = document.getElementById('correct-answer-text');
  const correct = correctInput.value.trim() || correctAnswer;

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: 'reveal_answer',
      correct_answer: correct
    }));
  }
}

function resetRound() {
  if (confirm('Reset the current quiz round?')) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: 'reset_round'
      }));
    }
  }
}

function handleQuestionPushed(data) {
  currentRoundNumber = data.round;
  correctAnswer = data.correct_answer || null;
  activeQuestionType = data.question_type || 'SHORT_ANSWER';
  activeQuizOptions = data.quiz_options || [];
  isAnswerRevealed = false;
  currentRoundAnswers = [];

  const roundBadge = document.getElementById('current-round-badge');
  if (roundBadge) roundBadge.innerText = `Round ${currentRoundNumber}`;

  updateActiveQuestionUI(data.question, currentRoundNumber, data.correct_answer, false);
}

function handleAnswerSubmitted(data) {
  currentRoundAnswers.push({ student_name: data.student_name, answer: data.answer });
  const statAns = document.getElementById('stat-responses');
  if (statAns) statAns.innerText = currentRoundAnswers.length;

  updateAnalyticsView();
}

function handleAnswerRevealed(data) {
  isAnswerRevealed = true;
  correctAnswer = data.correct_answer;
  updateActiveQuestionUI(document.getElementById('active-question-display').innerText, currentRoundNumber, correctAnswer, true);
  updateAnalyticsView();
}

function handleRoundReset(data) {
  currentRoundNumber = data.round || 0;
  currentRoundAnswers = [];
  correctAnswer = null;
  isAnswerRevealed = false;

  document.getElementById('active-question-display').innerText = 'No question currently active.';
  document.getElementById('btn-reveal').disabled = true;
  document.getElementById('btn-reset').disabled = true;
  document.getElementById('correct-banner').classList.add('hidden');
  document.getElementById('cluster-container').innerHTML = `
    <div style="color: var(--text-subtle); font-size: 0.85rem; text-align: center; padding: 2rem;">
      Waiting for responses... Answers will automatically cluster here.
    </div>
  `;
}

function updateActiveQuestionUI(questionText, roundNum, correctAns, isRevealed) {
  document.getElementById('active-question-display').innerText = questionText;
  document.getElementById('btn-reveal').disabled = false;
  document.getElementById('btn-reset').disabled = false;

  const banner = document.getElementById('correct-banner');
  const valDisplay = document.getElementById('correct-val-display');
  if (isRevealed && correctAns) {
    valDisplay.innerText = correctAns;
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}

function updateAnalyticsView() {
  const container = document.getElementById('cluster-container');
  if (!container) return;

  if (currentRoundAnswers.length === 0) {
    container.innerHTML = `
      <div style="color: var(--text-subtle); font-size: 0.85rem; text-align: center; padding: 2rem;">
        Waiting for responses... Answers will automatically cluster here.
      </div>
    `;
    return;
  }

  // Simple string normalization & fuzzy grouping
  const clustersMap = new Map();
  currentRoundAnswers.forEach(item => {
    const key = item.answer.trim().toLowerCase();
    if (!clustersMap.has(key)) {
      clustersMap.set(key, { displayAnswer: item.answer.trim(), students: [] });
    }
    clustersMap.get(key).students.push(item.student_name);
  });

  const sortedClusters = Array.from(clustersMap.values()).sort((a, b) => b.students.length - a.students.length);

  container.innerHTML = sortedClusters.map(cluster => {
    const isCorrect = isAnswerRevealed && correctAnswer && 
      cluster.displayAnswer.toLowerCase() === correctAnswer.trim().toLowerCase();
    
    return `
      <div class="cluster-card ${isCorrect ? 'correct' : ''}">
        <div class="cluster-header">
          <div class="cluster-title">${escapeHtml(cluster.displayAnswer)}</div>
          <span class="cluster-count">${cluster.students.length} ${cluster.students.length === 1 ? 'student' : 'students'}</span>
        </div>
        <div class="cluster-students">
          ${cluster.students.map(name => `<span class="student-chip">${escapeHtml(name)}</span>`).join('')}
        </div>
      </div>
    `;
  }).join('');
}

function changeSlide(direction) {
  if (!wb) return;
  let nextIdx = wb.currentSlideIndex + direction;
  if (nextIdx < 1) nextIdx = 1;
  if (nextIdx > wb.totalSlides) nextIdx = wb.totalSlides;
  
  wb.setSlide(nextIdx, wb.totalSlides);

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: 'change_slide',
      slide_index: nextIdx,
      total_slides: wb.totalSlides,
      slide_title: wb.slideTitle || `Slide ${nextIdx}`
    }));
  }
}

function handlePDFUpload(input) {
  if (input.files && input.files[0] && wb) {
    wb.loadPDFFile(input.files[0]);
  }
}

function setTool(toolName, btnElement) {
  if (wb) wb.currentTool = toolName;
  document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
  if (btnElement) btnElement.classList.add('active');
}

function setColor(hexColor, swatchElement) {
  if (wb) wb.currentColor = hexColor;
  document.querySelectorAll('.color-swatch').forEach(sw => sw.classList.remove('active'));
  if (swatchElement && swatchElement.classList.contains('color-swatch')) {
    swatchElement.classList.add('active');
  }
}

function setWidth(widthPx, btnElement) {
  if (wb) wb.currentWidth = widthPx;
  document.querySelectorAll('.width-pill').forEach(b => b.classList.remove('active'));
  if (btnElement) btnElement.classList.add('active');
}

function toggleGrid() {
  if (!wb) return;
  const modes = ['none', 'dots', 'math'];
  const nextIdx = (modes.indexOf(wb.backgroundGrid) + 1) % modes.length;
  wb.backgroundGrid = modes[nextIdx];
  wb.redrawAll();
}

function undoStroke() {
  if (wb) wb.undo();
}

function exportPNG() {
  if (wb) wb.exportAsImage();
}

function clearWhiteboard() {
  if (confirm('Clear the whiteboard for all participants?')) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: 'clear_whiteboard',
        student_name: 'Instructor (Teacher)'
      }));
    }
  }
}

function toggleQuizFields() {
  const qType = document.getElementById('quiz-type-select').value;
  const container = document.getElementById('mc-options-container');
  if (qType === 'MULTIPLE_CHOICE') {
    container.classList.remove('hidden');
  } else {
    container.classList.add('hidden');
  }
}

function switchTab(tabId, btnElement) {
  document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(tb => tb.classList.remove('active'));
  
  const target = document.getElementById(tabId);
  if (target) target.classList.add('active');
  if (btnElement) btnElement.classList.add('active');

  if (tabId === 'tab-whiteboard' && wb) {
    setTimeout(() => wb.redrawAll(), 50);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeJavaScriptString(str) {
  if (!str) return '';
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
