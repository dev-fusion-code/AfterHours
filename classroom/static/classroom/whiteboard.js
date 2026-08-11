// whiteboard.js — Multi-Tool Collaborative Engine, PDF Slide Deck Presentation & Real-Time Laser Pointer

class WhiteboardEngine {
  constructor(canvasId, socketSupplier, isTeacher = false, studentName = 'Teacher') {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.getSocket = socketSupplier;
    this.isTeacher = isTeacher;
    this.studentName = studentName;
    this.isDrawingAllowed = isTeacher;

    // Supported tools: 'pen', 'highlighter', 'line', 'arrow', 'rectangle', 'circle', 'triangle', 'text', 'sticky_note', 'eraser', 'laser'
    this.currentTool = 'pen';
    this.currentColor = '#0f172a';
    this.currentWidth = 5;
    this.backgroundGrid = 'none'; // 'none', 'dots', 'math', 'dark'

    // Presentation Slide State
    this.currentSlideIndex = 1;
    this.totalSlides = 5;
    this.pdfDoc = null;
    this.slideImageCache = new Map(); // pageNum -> Image object or Canvas

    // Active Drawing State
    this.isDrawing = false;
    this.startX = 0;
    this.startY = 0;
    this.currentEndPos = null;
    this.currentPoints = [];
    this.strokesHistory = [];
    this.undoStack = [];

    // Remote Laser Pointers & Cursors
    this.remoteCursors = new Map(); // studentName -> {x, y, isTeacher, active, timestamp}

    // Private Drawing & Canvas Mode State
    this.isPrivateMode = false;
    this.canvasMode = 'pdf'; // 'pdf' or 'blank'

    this.initCanvas();
    this.bindEvents();
    this.generateDefaultSlides();
  }

  initCanvas() {
    const updateSize = () => {
      const rect = this.canvas.parentElement.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        this.canvas.width = rect.width;
        this.canvas.height = rect.height;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.redrawAll();
      }
    };

    updateSize();
    setTimeout(updateSize, 100);
    setTimeout(updateSize, 500);

    window.addEventListener('resize', updateSize);

    // Animation loop for smooth glowing laser pointers
    requestAnimationFrame(() => this.animationLoop());
  }

  animationLoop() {
    if (this.remoteCursors.size > 0) {
      const now = Date.now();
      this.remoteCursors.forEach((c, name) => {
        if (now - c.timestamp > 3000) {
          this.remoteCursors.delete(name);
        }
      });
      this.redrawAll();
    }
    requestAnimationFrame(() => this.animationLoop());
  }

  setPermission(allowed) {
    this.isDrawingAllowed = this.isTeacher || allowed;
    const overlay = document.getElementById('whiteboard-status-overlay');
    if (overlay) {
      if (this.isTeacher) {
        overlay.innerText = '📡 Instructor Presentation Canvas';
        overlay.style.borderColor = 'var(--primary)';
        overlay.style.color = 'var(--primary)';
      } else if (this.isDrawingAllowed) {
        overlay.innerText = '✓ Drawing Access Granted';
        overlay.style.borderColor = '#16a34a';
        overlay.style.color = '#16a34a';
      } else {
        overlay.innerText = '🔒 Read-Only Mode (Waiting for Teacher Approval)';
        overlay.style.borderColor = '#cbd5e1';
        overlay.style.color = '#64748b';
      }
    }
  }

  bindEvents() {
    const getPos = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const scaleX = rect.width > 0 ? this.canvas.width / rect.width : 1;
      const scaleY = rect.height > 0 ? this.canvas.height / rect.height : 1;
      return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY
      };
    };

    const startDraw = (e) => {
      const pos = getPos(e);

      if (this.currentTool === 'laser') {
        this.isDrawing = true;
        this.emitLaserMove(pos.x, pos.y, true);
        return;
      }

      if (!this.isDrawingAllowed) return;
      this.isDrawing = true;
      this.startX = pos.x;
      this.startY = pos.y;
      this.currentEndPos = pos;
      this.currentPoints = [pos];

      if (this.currentTool === 'text') {
        const textVal = prompt('Enter text for canvas:');
        if (textVal && textVal.trim()) {
          const stroke = {
            tool: 'text',
            text: textVal.trim(),
            x: pos.x,
            y: pos.y,
            color: this.currentColor,
            width: this.currentWidth,
            slide: this.currentSlideIndex
          };
          this.addStroke(stroke);
          this.emitStroke(stroke);
        }
        this.isDrawing = false;
      } else if (this.currentTool === 'sticky_note') {
        const textVal = prompt('Enter Sticky Note text:');
        if (textVal && textVal.trim()) {
          const stroke = {
            tool: 'sticky_note',
            text: textVal.trim(),
            x: pos.x,
            y: pos.y,
            color: this.currentColor === '#ffffff' ? '#fbbf24' : this.currentColor,
            slide: this.currentSlideIndex
          };
          this.addStroke(stroke);
          this.emitStroke(stroke);
        }
        this.isDrawing = false;
      }
    };

    const moveDraw = (e) => {
      if (!this.isDrawing) return;
      e.preventDefault();
      const pos = getPos(e);

      if (this.currentTool === 'laser') {
        this.emitLaserMove(pos.x, pos.y, true);
        return;
      }

      if (!this.isDrawingAllowed) return;

      if (this.currentTool === 'pen' || this.currentTool === 'highlighter' || this.currentTool === 'eraser') {
        this.currentPoints.push(pos);
        this.redrawAll();
        const color = this.currentTool === 'eraser' ? '#ffffff' : this.currentColor;
        const width = this.currentTool === 'eraser' ? 25 : (this.currentTool === 'highlighter' ? 20 : this.currentWidth);
        const alpha = this.currentTool === 'highlighter' ? 0.45 : 1.0;
        this.renderPenStroke(this.currentPoints, color, width, alpha);
      } else if (['line', 'arrow', 'rectangle', 'circle', 'triangle'].includes(this.currentTool)) {
        this.currentEndPos = pos;
        this.redrawAll();
        this.renderShapePreview(this.currentTool, this.startX, this.startY, pos.x, pos.y, this.currentColor, this.currentWidth);
      }
    };

    const endDraw = () => {
      if (!this.isDrawing) return;
      this.isDrawing = false;

      if (this.currentTool === 'laser') {
        this.emitLaserMove(0, 0, false);
        return;
      }

      if (!this.isDrawingAllowed) return;

      if (this.currentTool === 'pen' || this.currentTool === 'highlighter' || this.currentTool === 'eraser') {
        if (this.currentPoints.length > 0) {
          const stroke = {
            tool: this.currentTool,
            points: [...this.currentPoints],
            color: this.currentTool === 'eraser' ? '#ffffff' : this.currentColor,
            width: this.currentTool === 'eraser' ? 25 : (this.currentTool === 'highlighter' ? 20 : this.currentWidth),
            slide: this.currentSlideIndex
          };
          this.addStroke(stroke);
          this.emitStroke(stroke);
        }
      } else if (['line', 'arrow', 'rectangle', 'circle', 'triangle'].includes(this.currentTool)) {
        const endPos = this.currentEndPos || { x: this.startX, y: this.startY };
        const stroke = {
          tool: this.currentTool,
          x1: this.startX,
          y1: this.startY,
          x2: endPos.x,
          y2: endPos.y,
          color: this.currentColor,
          width: this.currentWidth,
          slide: this.currentSlideIndex
        };
        this.addStroke(stroke);
        this.emitStroke(stroke);
      }
      this.currentPoints = [];
      this.currentEndPos = null;
    };

    this.canvas.addEventListener('mousedown', startDraw);
    this.canvas.addEventListener('mousemove', moveDraw);
    this.canvas.addEventListener('mouseup', endDraw);
    this.canvas.addEventListener('mouseleave', endDraw);

    this.canvas.addEventListener('touchstart', startDraw, { passive: false });
    this.canvas.addEventListener('touchmove', moveDraw, { passive: false });
    this.canvas.addEventListener('touchend', endDraw);
  }

  addStroke(stroke) {
    this.strokesHistory.push(stroke);
    this.redrawAll();
  }

  loadStrokes(strokes) {
    this.strokesHistory = strokes || [];
    this.redrawAll();
  }

  undo() {
    if (this.strokesHistory.length > 0) {
      const removed = this.strokesHistory.pop();
      this.undoStack.push(removed);
      this.redrawAll();
      const socket = this.getSocket();
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'undo_stroke', student_name: this.studentName }));
      }
    }
  }

  clearCanvas() {
    this.strokesHistory = [];
    this.redrawAll();
  }

  // Presentation Slide Navigation & PDF Loading
  setSlide(slideIndex, totalSlides = null, slideDataUrl = null) {
    this.currentSlideIndex = slideIndex;
    if (totalSlides) this.totalSlides = totalSlides;

    if (slideDataUrl) {
      const img = new Image();
      img.onload = () => {
        this.slideImageCache.set(slideIndex, img);
        this.redrawAll();
      };
      img.src = slideDataUrl;
    }

    this.updateSlideUI();
    this.redrawAll();
  }

  updateSlideUI() {
    const display = document.getElementById('slide-counter-display');
    if (display) {
      display.innerText = `Slide ${this.currentSlideIndex} of ${this.totalSlides}`;
    }
  }

  generateDefaultSlides() {
    for (let i = 1; i <= 5; i++) {
      const offscreen = document.createElement('canvas');
      offscreen.width = 1200;
      offscreen.height = 700;
      const ctx = offscreen.getContext('2d');

      ctx.fillStyle = i === 1 ? '#0f172a' : (i % 2 === 0 ? '#ffffff' : '#f8fafc');
      ctx.fillRect(0, 0, 1200, 700);

      if (i === 1) {
        ctx.fillStyle = '#38bdf8';
        ctx.font = 'bold 44px Inter, sans-serif';
        ctx.fillText('🚀 HUDDLE INTERACTIVE CLASSROOM', 100, 220);

        ctx.fillStyle = '#f8fafc';
        ctx.font = 'bold 28px Inter, sans-serif';
        ctx.fillText('Real-Time Collaboration, PDF Presentation & Live Analytics', 100, 280);

        ctx.fillStyle = '#94a3b8';
        ctx.font = '20px Inter, sans-serif';
        ctx.fillText('• Use Pen, Highlighter, Shapes, Sticky Notes & Laser Pointer', 100, 360);
        ctx.fillText('• Use PDF/Deck switcher or upload custom slides', 100, 400);
        ctx.fillText('• Chat live with participants in real-time', 100, 440);
      } else {
        ctx.fillStyle = '#2563eb';
        ctx.font = 'bold 36px Inter, sans-serif';
        ctx.fillText(`Lecture Topic #${i - 1}: Interactive Diagram & Notes`, 80, 120);

        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(80, 150);
        ctx.lineTo(1120, 150);
        ctx.stroke();

        ctx.fillStyle = '#f1f5f9';
        ctx.fillRect(80, 180, 500, 350);
        ctx.strokeStyle = '#cbd5e1';
        ctx.strokeRect(80, 180, 500, 350);

        ctx.fillStyle = '#64748b';
        ctx.font = '18px Inter, sans-serif';
        ctx.fillText(`Diagram Canvas Space (Slide ${i})`, 180, 360);

        ctx.fillStyle = '#1e293b';
        ctx.font = '600 22px Inter, sans-serif';
        ctx.fillText('Key Learning Points:', 620, 220);
        ctx.font = '18px Inter, sans-serif';
        ctx.fillStyle = '#475569';
        ctx.fillText('1. Active student engagement', 620, 270);
        ctx.fillText('2. Real-time misconceptions clustering', 620, 320);
        ctx.fillText('3. Direct laser annotation on slides', 620, 370);
        ctx.fillText('4. Dynamic shape & sticky note drawing', 620, 420);
      }

      this.slideImageCache.set(i, offscreen);
    }
  }

  loadPDFFile(file) {
    if (!window.pdfjsLib) {
      alert('PDF rendering engine is loading. Please try again in a moment.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const arrayBuffer = e.target.result;
      pdfjsLib.getDocument({ data: arrayBuffer }).promise.then(pdf => {
        this.pdfDoc = pdf;
        this.totalSlides = pdf.numPages;
        this.currentSlideIndex = 1;
        this.slideTitle = file.name;
        this.slideImageCache.clear();
        this.renderPDFPage(1, () => {
          this.setSlide(1, pdf.numPages);
        });
      }).catch(err => {
        console.error('Failed to load PDF file:', err);
        alert('Failed to load PDF file.');
      });
    };
    reader.readAsArrayBuffer(file);
  }

  renderPDFPage(pageNum, callback) {
    if (!this.pdfDoc) return;
    this.pdfDoc.getPage(pageNum).then(page => {
      const viewport = page.getViewport({ scale: 1.5 });
      const offscreen = document.createElement('canvas');
      offscreen.width = viewport.width;
      offscreen.height = viewport.height;
      const renderCtx = offscreen.getContext('2d');
      const renderContext = {
        canvasContext: renderCtx,
        viewport: viewport
      };
      page.render(renderContext).promise.then(() => {
        this.slideImageCache.set(pageNum, offscreen);
        const dataUrl = offscreen.toDataURL('image/jpeg', 0.85);

        if (this.isTeacher) {
          const socket = this.getSocket();
          if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
              type: 'change_slide',
              slide_index: pageNum,
              total_slides: this.totalSlides,
              slide_title: this.slideTitle || 'Lecture Presentation',
              slide_data_url: dataUrl
            }));
          }
        }

        if (callback) callback();
        this.redrawAll();
      });
    });
  }

  setCanvasMode(mode) {
    this.canvasMode = mode;
    this.redrawAll();
  }

  // Main Drawing & Rendering Method
  redrawAll() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (this.canvasMode === 'blank') {
      // Solid Whiteboard mode
      this.ctx.fillStyle = this.backgroundGrid === 'dark' ? '#0f172a' : '#ffffff';
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    } else {
      // 1. Render Background Slide Image if available (PDF / Presentation Deck)
      const slideImg = this.slideImageCache.get(this.currentSlideIndex);
      if (slideImg) {
        this.ctx.drawImage(slideImg, 0, 0, this.canvas.width, this.canvas.height);
      } else if (this.pdfDoc) {
        this.renderPDFPage(this.currentSlideIndex);
        return;
      } else {
        this.ctx.fillStyle = this.backgroundGrid === 'dark' ? '#0f172a' : '#ffffff';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      }
    }

    // 2. Render Background Grid Lines if selected
    this.renderBackgroundGrid();

    // 3. Render Historical Strokes for Active Slide
    this.strokesHistory.forEach(stroke => {
      if (!stroke.slide || stroke.slide === this.currentSlideIndex) {
        this.renderSingleStroke(stroke);
      }
    });

    // 4. Render Active Remote Laser Pointers & Cursors
    this.renderRemoteCursors();
  }

  renderBackgroundGrid() {
    if (this.backgroundGrid === 'none') return;

    this.ctx.save();
    if (this.backgroundGrid === 'dots') {
      this.ctx.fillStyle = '#cbd5e1';
      for (let x = 20; x < this.canvas.width; x += 25) {
        for (let y = 20; y < this.canvas.height; y += 25) {
          this.ctx.beginPath();
          this.ctx.arc(x, y, 1.5, 0, Math.PI * 2);
          this.ctx.fill();
        }
      }
    } else if (this.backgroundGrid === 'math') {
      this.ctx.strokeStyle = 'rgba(203, 213, 225, 0.4)';
      this.ctx.lineWidth = 1;
      for (let x = 0; x < this.canvas.width; x += 25) {
        this.ctx.beginPath();
        this.ctx.moveTo(x, 0);
        this.ctx.lineTo(x, this.canvas.height);
        this.ctx.stroke();
      }
      for (let y = 0; y < this.canvas.height; y += 25) {
        this.ctx.beginPath();
        this.ctx.moveTo(0, y);
        this.ctx.lineTo(this.canvas.width, y);
        this.ctx.stroke();
      }
    }
    this.ctx.restore();
  }

  renderSingleStroke(stroke) {
    if (!stroke) return;

    if (stroke.tool === 'pen' || stroke.tool === 'eraser' || stroke.tool === 'highlighter') {
      const alpha = stroke.tool === 'highlighter' ? 0.45 : 1.0;
      const width = stroke.tool === 'eraser' ? 25 : (stroke.tool === 'highlighter' ? 20 : stroke.width);
      const color = stroke.tool === 'eraser' ? (this.backgroundGrid === 'dark' ? '#0f172a' : '#ffffff') : stroke.color;
      this.renderPenStroke(stroke.points, color, width, alpha);
    } else if (['line', 'arrow', 'rectangle', 'circle', 'triangle'].includes(stroke.tool)) {
      this.renderShapePreview(stroke.tool, stroke.x1, stroke.y1, stroke.x2, stroke.y2, stroke.color, stroke.width);
    } else if (stroke.tool === 'text') {
      this.ctx.save();
      this.ctx.font = 'bold 18px Inter, sans-serif';
      this.ctx.fillStyle = stroke.color || '#0f172a';
      this.ctx.fillText(stroke.text || '', stroke.x, stroke.y);
      this.ctx.restore();
    } else if (stroke.tool === 'sticky_note') {
      this.renderStickyNote(stroke.x, stroke.y, stroke.text, stroke.color);
    }
  }

  renderPenStroke(points, color, width, alpha = 1.0) {
    if (!points || points.length < 1) return;
    this.ctx.save();
    this.ctx.globalAlpha = alpha;
    this.ctx.beginPath();
    this.ctx.strokeStyle = color || '#0f172a';
    this.ctx.lineWidth = width || 3;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';

    if (points.length === 1) {
      this.ctx.arc(points[0].x, points[0].y, width / 2, 0, Math.PI * 2);
      this.ctx.fillStyle = color;
      this.ctx.fill();
    } else {
      this.ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        this.ctx.lineTo(points[i].x, points[i].y);
      }
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  renderShapePreview(tool, x1, y1, x2, y2, color, width) {
    this.ctx.save();
    this.ctx.strokeStyle = color || '#0f172a';
    this.ctx.lineWidth = width || 3;
    this.ctx.fillStyle = color || '#0f172a';

    if (tool === 'line') {
      this.ctx.beginPath();
      this.ctx.moveTo(x1, y1);
      this.ctx.lineTo(x2, y2);
      this.ctx.stroke();
    } else if (tool === 'arrow') {
      this.ctx.beginPath();
      this.ctx.moveTo(x1, y1);
      this.ctx.lineTo(x2, y2);
      this.ctx.stroke();

      const angle = Math.atan2(y2 - y1, x2 - x1);
      const headLen = Math.max(12, width * 3);
      this.ctx.beginPath();
      this.ctx.moveTo(x2, y2);
      this.ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
      this.ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
      this.ctx.closePath();
      this.ctx.fill();
    } else if (tool === 'rectangle') {
      const w = x2 - x1;
      const h = y2 - y1;
      this.ctx.beginPath();
      this.ctx.rect(x1, y1, w, h);
      this.ctx.stroke();
    } else if (tool === 'circle') {
      const radius = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
      this.ctx.beginPath();
      this.ctx.arc(x1, y1, radius, 0, Math.PI * 2);
      this.ctx.stroke();
    } else if (tool === 'triangle') {
      this.ctx.beginPath();
      this.ctx.moveTo(x1 + (x2 - x1) / 2, y1);
      this.ctx.lineTo(x1, y2);
      this.ctx.lineTo(x2, y2);
      this.ctx.closePath();
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  renderStickyNote(x, y, text, color) {
    this.ctx.save();
    const width = 160;
    const height = 120;

    this.ctx.shadowColor = 'rgba(0, 0, 0, 0.15)';
    this.ctx.shadowBlur = 8;
    this.ctx.shadowOffsetX = 3;
    this.ctx.shadowOffsetY = 4;

    this.ctx.fillStyle = color || '#fef08a';
    this.ctx.beginPath();
    this.ctx.roundRect(x, y, width, height, 8);
    this.ctx.fill();

    this.ctx.shadowColor = 'transparent';
    this.ctx.fillStyle = '#0f172a';
    this.ctx.font = '14px Inter, sans-serif';

    const words = (text || '').split(' ');
    let line = '';
    let currY = y + 25;
    for (let n = 0; n < words.length; n++) {
      const testLine = line + words[n] + ' ';
      const metrics = this.ctx.measureText(testLine);
      if (metrics.width > width - 20 && n > 0) {
        this.ctx.fillText(line, x + 10, currY);
        line = words[n] + ' ';
        currY += 20;
      } else {
        line = testLine;
      }
    }
    this.ctx.fillText(line, x + 10, currY);
    this.ctx.restore();
  }

  emitLaserMove(x, y, active) {
    const socket = this.getSocket();
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: 'laser_move',
        x: x,
        y: y,
        student_name: this.studentName,
        is_teacher: this.isTeacher,
        active: active
      }));
    }
  }

  handleRemoteLaser(x, y, studentName, isTeacher, active) {
    if (!active) {
      this.remoteCursors.delete(studentName);
    } else {
      this.remoteCursors.set(studentName, {
        x: x,
        y: y,
        isTeacher: isTeacher,
        active: true,
        timestamp: Date.now()
      });
    }
    this.redrawAll();
  }

  renderRemoteCursors() {
    this.remoteCursors.forEach((cursor, name) => {
      this.ctx.save();

      const color = cursor.isTeacher ? '#ef4444' : '#10b981';

      this.ctx.beginPath();
      this.ctx.arc(cursor.x, cursor.y, 8, 0, Math.PI * 2);
      this.ctx.fillStyle = color;
      this.ctx.shadowColor = color;
      this.ctx.shadowBlur = 12;
      this.ctx.fill();

      this.ctx.beginPath();
      this.ctx.arc(cursor.x, cursor.y, 14, 0, Math.PI * 2);
      this.ctx.strokeStyle = color;
      this.ctx.lineWidth = 2;
      this.ctx.stroke();

      this.ctx.shadowColor = 'transparent';
      this.ctx.fillStyle = cursor.isTeacher ? '#ef4444' : '#0f172a';
      this.ctx.font = 'bold 12px Inter, sans-serif';
      this.ctx.fillText(`🔦 ${name}`, cursor.x + 16, cursor.y + 4);

      this.ctx.restore();
    });
  }

  exportAsImage() {
    const link = document.createElement('a');
    link.download = `Huddle_Whiteboard_Slide_${this.currentSlideIndex}.png`;
    link.href = this.canvas.toDataURL('image/png');
    link.click();
  }

  emitStroke(stroke) {
    if (this.isPrivateMode) {
      stroke.is_private = true;
    }
    const socket = this.getSocket();
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: 'draw_stroke',
        stroke: stroke,
        student_name: this.studentName,
        is_private: this.isPrivateMode
      }));
    }
  }
}
