// student.js — Student Portal Controller

let socket = null;
let wb = null;
let isApprovedToDraw = false;
let currentRound = 0;
let submittedAnswer = null;
let selectedOption = null;

let studentChatTab = 'public'; // 'public' or 'private'
let studentChatMessages = [];

document.addEventListener('DOMContentLoaded', () => {
  wb = new WhiteboardEngine('whiteboard-canvas', () => socket, false, window.STUDENT_NAME || 'Student');
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
    updateWsStatus('live', 'Connected');
    socket.send(JSON.stringify({
      type: 'register_role',
      role: 'student',
      student_name: window.STUDENT_NAME || 'Student'
    }));

    socket.send(JSON.stringify({
      type: 'student_joined',
      student_name: window.STUDENT_NAME || 'Student'
    }));
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
  const badge = document.getElementById('permission-status-pill');
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
      if (wb && data.student_name !== (window.STUDENT_NAME || 'Student')) {
        wb.addStroke(data.stroke);
      }
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
      updateCanvasModeIndicator(data.mode);
      break;
    case 'laser_moved':
      if (wb && data.student_name !== (window.STUDENT_NAME || 'Student')) {
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
    case 'answer_revealed':
      handleAnswerRevealed(data);
      break;
    case 'round_reset':
      handleRoundReset(data);
      break;
  }
}

function handleInitState(data) {
  currentRound = data.round || 0;

  // Sync Presentation Slide & Whiteboard Strokes & Mode
  if (wb) {
    if (data.strokes) wb.loadStrokes(data.strokes);
    if (data.current_slide_index) wb.setSlide(data.current_slide_index, data.total_slides || 5, data.slide_data_url);
    if (data.canvas_mode) {
      wb.setCanvasMode(data.canvas_mode);
      updateCanvasModeIndicator(data.canvas_mode);
    }
  }

  // Sync Recent Chat History
  if (data.recent_chats && Array.isArray(data.recent_chats)) {
    studentChatMessages = [];
    data.recent_chats.forEach(c => {
      renderChatMessage(c.sender_name, c.message, c.is_teacher, c.timestamp, c.is_private, c.recipient_name);
    });
  }

  // Check Approval Status
  const approvedSet = new Set(data.approved_students || []);
  isApprovedToDraw = approvedSet.has(window.STUDENT_NAME);
  updatePermissionUI(isApprovedToDraw);

  if (data.active_question) {
    handleQuestionPushed({
      question: data.active_question,
      question_type: data.question_type,
      quiz_options: data.quiz_options,
      round: data.round
    });
  }
}

function updateCanvasModeIndicator(mode) {
  const badge = document.getElementById('canvas-mode-indicator-badge');
  if (badge) {
    if (mode === 'blank') {
      badge.innerText = '🖊 Blank Whiteboard';
      badge.style.background = 'rgba(37, 99, 235, 0.1)';
      badge.style.color = 'var(--primary)';
    } else {
      badge.innerText = '📄 PDF Slide';
      badge.style.background = 'var(--surface-subtle)';
      badge.style.color = 'var(--text-muted)';
    }
  }
}

function handlePermissionUpdated(data) {
  if (data.student_name === window.STUDENT_NAME) {
    isApprovedToDraw = data.approved;
    updatePermissionUI(isApprovedToDraw);
  }
}

function updatePermissionUI(allowed) {
  if (wb) wb.setPermission(allowed);
  const toolbar = document.getElementById('student-toolbar');
  const pill = document.getElementById('permission-status-pill');

  if (toolbar) {
    toolbar.style.opacity = allowed ? '1' : '0.5';
    toolbar.style.pointerEvents = allowed ? 'auto' : 'none';
  }

  if (pill) {
    if (allowed) {
      pill.className = 'status-pill status-live';
      pill.innerHTML = '<span class="dot"></span> Drawing Access Granted';
    } else {
      pill.className = 'status-pill';
      pill.style.color = 'var(--text-muted)';
      pill.innerHTML = '🔒 Read-Only Mode';
    }
  }
}

function togglePrivateDraw(btnElement) {
  if (!wb) return;
  wb.isPrivateMode = !wb.isPrivateMode;
  if (btnElement) {
    btnElement.classList.toggle('active', wb.isPrivateMode);
    if (wb.isPrivateMode) {
      btnElement.innerText = '🔒 Private Draw (ON)';
      btnElement.style.borderColor = '#9333ea';
      btnElement.style.color = '#9333ea';
    } else {
      btnElement.innerText = '🔒 Private Draw';
      btnElement.style.borderColor = '';
      btnElement.style.color = '';
    }
  }
}

function switchStudentChatTab(tab) {
  studentChatTab = tab;
  const btnPub = document.getElementById('student-chat-public');
  const btnPriv = document.getElementById('student-chat-private');

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

  renderStudentChatMessages();
}

function sendChatMessage() {
  const input = document.getElementById('chat-input');
  if (!input) return;
  const msg = input.value.trim();
  if (!msg) return;

  const isPrivate = studentChatTab === 'private';

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: 'chat_message',
      sender_name: window.STUDENT_NAME || 'Student',
      message: msg,
      is_teacher: false,
      is_private: isPrivate,
      recipient_name: 'Teacher'
    }));
    input.value = '';
  }
}

function renderChatMessage(sender, msg, isTeacher, timestamp, isPrivate = false, recipientName = 'Teacher') {
  studentChatMessages.push({ sender, msg, isTeacher, timestamp, isPrivate, recipientName });
  renderStudentChatMessages();
}

function renderStudentChatMessages() {
  const box = document.getElementById('chat-messages-box');
  if (!box) return;

  box.innerHTML = '';

  const myName = window.STUDENT_NAME || 'Student';

  const filtered = studentChatMessages.filter(c => {
    if (studentChatTab === 'public') {
      return !c.isPrivate;
    } else {
      return c.isPrivate && (c.sender === myName || c.recipientName === myName || c.recipientName === 'ALL' || c.sender === 'Teacher' || c.sender === 'Instructor (Teacher)');
    }
  });

  if (filtered.length === 0) {
    box.innerHTML = `
      <div style="color: var(--text-subtle); font-size: 0.8rem; text-align: center; padding: 1.5rem 0;">
        ${studentChatTab === 'public' ? 'Welcome to the live chat!' : 'No private DM messages with teacher yet.'}
      </div>
    `;
    return;
  }

  filtered.forEach(c => {
    const isMe = c.sender === myName;
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${isMe ? 'me' : ''} ${c.isTeacher ? 'teacher' : ''}`;
    if (c.isPrivate) {
      bubble.style.borderLeft = '3px solid #9333ea';
    }

    let tagHtml = c.isTeacher ? '<span class="chat-teacher-badge">INSTRUCTOR</span>' : '';
    if (c.isPrivate) {
      tagHtml += ` <span style="font-size: 0.65rem; background: rgba(147, 51, 234, 0.1); color: #9333ea; padding: 0.05rem 0.35rem; border-radius: 9999px; font-weight: 700;">🔒 Private DM</span>`;
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

function handleQuestionPushed(data) {
  currentRound = data.round || 0;
  submittedAnswer = null;
  selectedOption = null;

  document.getElementById('state-waiting').classList.add('hidden');
  document.getElementById('state-active').classList.remove('hidden');
  document.getElementById('submission-feedback').classList.add('hidden');
  document.getElementById('reveal-banner').classList.add('hidden');

  const roundBadge = document.getElementById('question-round-badge');
  if (roundBadge) roundBadge.innerText = `Round ${currentRound}`;

  const prompt = document.getElementById('question-prompt-text');
  if (prompt) prompt.innerText = data.question;

  const formShort = document.getElementById('form-short-answer');
  const formMC = document.getElementById('form-multiple-choice');

  if (data.question_type === 'MULTIPLE_CHOICE') {
    formShort.classList.add('hidden');
    formMC.classList.remove('hidden');

    const grid = document.getElementById('mc-options-grid');
    grid.innerHTML = (data.quiz_options || []).map((opt, i) => `
      <div class="quiz-opt-card" id="opt-card-${i}" onclick="selectQuizOption('${escapeJavaScriptString(opt)}', ${i})">
        <span class="opt-key">${String.fromCharCode(65 + i)}</span>
        <span>${escapeHtml(opt)}</span>
      </div>
    `).join('');
  } else {
    formMC.classList.add('hidden');
    formShort.classList.remove('hidden');
    document.getElementById('short-answer-input').value = '';
  }
}

function selectQuizOption(optText, index) {
  selectedOption = optText;
  document.querySelectorAll('.quiz-opt-card').forEach(card => card.classList.remove('selected'));
  const target = document.getElementById(`opt-card-${index}`);
  if (target) target.classList.add('selected');
}

function submitShortAnswer() {
  const input = document.getElementById('short-answer-input');
  const answerVal = input.value.trim();
  if (!answerVal) return;
  sendAnswer(answerVal);
}

function submitMultipleChoice() {
  if (!selectedOption) {
    alert('Please select an option first.');
    return;
  }
  sendAnswer(selectedOption);
}

function sendAnswer(answerVal) {
  submittedAnswer = answerVal;

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: 'submit_answer',
      student_name: window.STUDENT_NAME || 'Student',
      answer: answerVal,
      round: currentRound
    }));
  }

  document.getElementById('submitted-val-display').innerText = answerVal;
  document.getElementById('submission-feedback').classList.remove('hidden');
}

function handleAnswerRevealed(data) {
  const banner = document.getElementById('reveal-banner');
  const correctVal = document.getElementById('reveal-correct-val');
  const yourVal = document.getElementById('reveal-your-val');

  if (correctVal) correctVal.innerText = data.correct_answer || '--';
  if (yourVal) yourVal.innerText = submittedAnswer || 'No response submitted';
  if (banner) banner.classList.remove('hidden');
}

function handleRoundReset(data) {
  currentRound = data.round || 0;
  submittedAnswer = null;
  selectedOption = null;
  showWaitingUI();
}

function showWaitingUI() {
  document.getElementById('state-active').classList.add('hidden');
  document.getElementById('state-waiting').classList.remove('hidden');
}

function setTool(toolName, btnElement) {
  if (wb) wb.currentTool = toolName;
  document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
  if (btnElement) btnElement.classList.add('active');
}

function setColor(hexColor, swatchElement) {
  if (wb) wb.currentColor = hexColor;
  document.querySelectorAll('.color-swatch').forEach(sw => sw.classList.remove('active'));
  if (swatchElement) swatchElement.classList.add('active');
}

function exportPNG() {
  if (wb) wb.exportAsImage();
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
