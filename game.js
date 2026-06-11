// ── Constants ─────────────────────────────────────────────
const IS_MOBILE = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
const GRID_SIZE    = 8;
const UNIT_SIZE    = IS_MOBILE ? 5.5 : 1.0;   // 1.0 on desktop = exact float, no drift
const MOVE_INTERVAL = 400;
const COLORS = {
    snake:     0x00ff00,
    food:      0xff3333,
    gridLines: 0xffffff,
    xAxis:     0xff0000,
    yAxis:     0x00ff00,
    zAxis:     0x0088ff
};

// ── Game state ────────────────────────────────────────────
let scene, camera, renderer, gameGroup;
let snake = [], food;
let direction     = { x: 1, y: 0, z: 0 };
let nextDirection = { x: 1, y: 0, z: 0 };
let directionQueue = [];
let score      = 0;
let isGameOver = false;
let isPaused   = false;
let moveTimer  = null;

// ── View state (all devices) ──────────────────────────────
let currentScale     = 1.0;
let currentRotationY = Math.PI * 0.005;
const MIN_SCALE = 0.4;
const MAX_SCALE = 2.5;

// ── Mouse (desktop drag & zoom) ───────────────────────────
let isMouseDown = false;
let mouseLastX  = 0;

// ── Touch (pinch & rotate) ────────────────────────────────
let lastTouchX        = 0;
let isSingleTouch     = false;
let pinchStartDist    = 0;
let lastPinchCenterX  = 0;

// ── DOM ───────────────────────────────────────────────────
const scoreBoard     = document.getElementById('scoreBoard');
const gameOverScreen = document.getElementById('gameOverScreen');
const finalScore     = document.getElementById('finalScore');
const restartButton  = document.getElementById('restartButton');
let pauseButton = null;

// ─────────────────────────────────────────────────────────
function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111111);

    // Restore saved view settings
    try {
        const s = JSON.parse(localStorage.getItem('snake3dSettings') || '{}');
        if (s.rotation != null) currentRotationY = s.rotation;
        if (s.scale    != null) currentScale     = s.scale;
    } catch (_) {}

    // Mobile body fix
    if (IS_MOBILE) {
        document.body.style.cssText +=
            ';overflow:hidden;position:fixed;width:100%;height:100%;margin:0;padding:0';
    }

    gameGroup = new THREE.Group();
    scene.add(gameGroup);

    const totalSize = GRID_SIZE * UNIT_SIZE;

    camera = new THREE.PerspectiveCamera(
        IS_MOBILE ? 60 : 50,
        window.innerWidth / window.innerHeight,
        0.1, 1000
    );
    camera.position.set(totalSize, totalSize, totalSize * 2);
    camera.lookAt(totalSize * 0.5, totalSize * 0.5, totalSize * 0.5);

    gameGroup.rotation.y = currentRotationY;
    gameGroup.scale.set(currentScale, currentScale, currentScale);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    createGrid();
    createSnake();
    createFood();
    createPauseButton();

    if (IS_MOBILE) {
        createMobileControls();
    } else {
        addDesktopInstructions();
    }

    // Event listeners
    window.addEventListener('keydown', handleKeyPress);
    window.addEventListener('resize',  handleResize);
    restartButton.addEventListener('click', restartGame);

    // Touch: rotate (1-finger) + pinch zoom (2-finger) on canvas — all devices
    renderer.domElement.addEventListener('touchstart', onTouchStart, { passive: false });
    renderer.domElement.addEventListener('touchmove',  onTouchMove,  { passive: false });
    renderer.domElement.addEventListener('touchend',   onTouchEnd,   { passive: false });

    // Mouse drag to rotate — all devices
    renderer.domElement.addEventListener('mousedown', e => {
        isMouseDown = true;
        mouseLastX  = e.clientX;
        renderer.domElement.style.cursor = 'grabbing';
    });
    window.addEventListener('mousemove', e => {
        if (!isMouseDown) return;
        const dx = e.clientX - mouseLastX;
        mouseLastX = e.clientX;
        currentRotationY += dx * 0.008;
        gameGroup.rotation.y = currentRotationY;
        saveSettings();
    });
    window.addEventListener('mouseup', () => {
        isMouseDown = false;
        renderer.domElement.style.cursor = 'grab';
    });
    renderer.domElement.style.cursor = 'grab';

    // Scroll / wheel to zoom — all devices
    renderer.domElement.addEventListener('wheel', e => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
        currentScale = Math.max(MIN_SCALE, Math.min(currentScale * factor, MAX_SCALE));
        gameGroup.scale.set(currentScale, currentScale, currentScale);
        saveSettings();
    }, { passive: false });

    moveTimer = setInterval(moveSnake, MOVE_INTERVAL);
    animate();
}

// ── Desktop instructions ──────────────────────────────────
function addDesktopInstructions() {
    const el = document.createElement('div');
    Object.assign(el.style, {
        position: 'fixed', top: '10px', left: '50%', transform: 'translateX(-50%)',
        textAlign: 'center', color: 'white', fontSize: '13px',
        fontFamily: 'Arial, sans-serif', zIndex: '1000', padding: '5px 16px',
        backgroundColor: 'rgba(0,0,0,0.55)', pointerEvents: 'none',
        borderRadius: '6px', whiteSpace: 'nowrap'
    });
    el.innerHTML =
        '<span style="color:#ff0000">X</span>: ←/→ &nbsp;|&nbsp; ' +
        '<span style="color:#00ff00">Y</span>: W/S &nbsp;|&nbsp; ' +
        '<span style="color:#0088ff">Z</span>: ↑/↓ &nbsp;|&nbsp; ' +
        'Drag to rotate &nbsp;|&nbsp; Scroll to zoom &nbsp;|&nbsp; P = pause';
    document.body.appendChild(el);

    // Push score and pause button below the instruction bar
    const barH = 44;
    scoreBoard.style.top = barH + 'px';
}

// ── Pause button ──────────────────────────────────────────
function createPauseButton() {
    pauseButton = document.createElement('button');
    pauseButton.textContent = '||';
    Object.assign(pauseButton.style, {
        position: 'fixed', top: IS_MOBILE ? '14px' : '44px', right: '14px',
        background: 'rgba(255,255,255,0.13)',
        color: 'white', border: '1px solid rgba(255,255,255,0.35)',
        borderRadius: '8px', padding: IS_MOBILE ? '8px 16px' : '5px 13px',
        fontSize: IS_MOBILE ? '20px' : '16px',
        cursor: 'pointer', zIndex: '1500', fontFamily: 'Arial, sans-serif'
    });
    pauseButton.addEventListener('click', togglePause);
    document.body.appendChild(pauseButton);
}

function togglePause() {
    if (isGameOver) return;
    isPaused = !isPaused;
    if (isPaused) {
        clearInterval(moveTimer);
        moveTimer = null;
        pauseButton.textContent = '▶';
    } else {
        moveTimer = setInterval(moveSnake, MOVE_INTERVAL);
        pauseButton.textContent = '||';
    }
}

// ── Grid & axes ───────────────────────────────────────────
function createGrid() {
    const s = GRID_SIZE * UNIT_SIZE;

    // Wireframe bounding box
    const box = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(s, s, s)),
        new THREE.LineBasicMaterial({ color: COLORS.gridLines })
    );
    box.position.set(s / 2, s / 2, s / 2);
    gameGroup.add(box);

    // Floor grid
    const floor = new THREE.GridHelper(s, GRID_SIZE, 0x444444, 0x444444);
    floor.position.set(s / 2, 0, s / 2);
    gameGroup.add(floor);

    // Coloured axes
    const axW = IS_MOBILE ? 7 : 3;
    const cR  = IS_MOBILE ? 0.8 : 0.2;
    const cH  = IS_MOBILE ? 1.6 : 0.4;

    const addAxis = (color, end, rotAxis, rotAng) => {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, ...end], 3));
        gameGroup.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color, linewidth: axW })));

        const cone = new THREE.Mesh(
            new THREE.ConeGeometry(cR, cH, 12),
            new THREE.MeshBasicMaterial({ color })
        );
        cone.position.set(...end);
        if (rotAxis) cone.rotation[rotAxis] = rotAng;
        gameGroup.add(cone);
    };

    addAxis(COLORS.xAxis, [s, 0, 0], 'z', -Math.PI / 2);
    addAxis(COLORS.yAxis, [0, s, 0], null, 0);
    addAxis(COLORS.zAxis, [0, 0, s], 'x',  Math.PI / 2);
}

// ── Snake ─────────────────────────────────────────────────
function createSnake() {
    const geo = new THREE.BoxGeometry(UNIT_SIZE * 0.9, UNIT_SIZE * 0.9, UNIT_SIZE * 0.9);
    const mat = new THREE.MeshBasicMaterial({ color: COLORS.snake });
    const cx  = Math.floor(GRID_SIZE / 2) * UNIT_SIZE;
    const cy  = Math.floor(GRID_SIZE / 2) * UNIT_SIZE;
    const cz  = Math.floor(GRID_SIZE / 2) * UNIT_SIZE;

    for (let i = 0; i < 3; i++) {
        const seg = new THREE.Mesh(geo.clone(), mat.clone());
        const pos = { x: cx - i * UNIT_SIZE, y: cy, z: cz };
        seg.position.set(pos.x, pos.y, pos.z);
        snake.push({ mesh: seg, position: { ...pos } });
        gameGroup.add(seg);
    }
    direction = nextDirection = { x: 1, y: 0, z: 0 };
}

// ── Food ──────────────────────────────────────────────────
function createFood() {
    if (food) gameGroup.remove(food.mesh);

    let fx, fy, fz;
    do {
        fx = Math.floor(Math.random() * GRID_SIZE) * UNIT_SIZE;
        fy = Math.floor(Math.random() * GRID_SIZE) * UNIT_SIZE;
        fz = Math.floor(Math.random() * GRID_SIZE) * UNIT_SIZE;
    } while (snake.some(s => posEqual(s.position, { x: fx, y: fy, z: fz })));

    const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(UNIT_SIZE * 0.6, 16, 16),
        new THREE.MeshBasicMaterial({ color: COLORS.food })
    );
    mesh.position.set(fx, fy, fz);
    food = { mesh, position: { x: fx, y: fy, z: fz } };
    gameGroup.add(mesh);
}

// Epsilon-based position equality — handles float-point drift
function posEqual(a, b) {
    const eps = UNIT_SIZE * 0.1;
    return Math.abs(a.x - b.x) < eps
        && Math.abs(a.y - b.y) < eps
        && Math.abs(a.z - b.z) < eps;
}

// ── Mobile controls ───────────────────────────────────────
function createMobileControls() {
    // Inject responsive CSS — adapts automatically on orientation change
    const style = document.createElement('style');
    style.textContent = `
        #mc-wrap {
            position: fixed; bottom: 18px; left: 0; width: 100%;
            display: flex; justify-content: space-around; align-items: flex-end;
            padding: 0 16px; box-sizing: border-box; z-index: 1000;
            pointer-events: none;
        }
        #mc-dpad {
            display: grid;
            grid-template-columns: repeat(3, 54px);
            grid-template-rows: repeat(3, 54px);
            gap: 5px; pointer-events: all;
        }
        #mc-dpad button {
            width: 100%; height: 100%; margin: 0; border: none;
            border-radius: 11px; font-size: 22px; font-weight: bold;
            color: white; cursor: pointer; pointer-events: all;
            box-shadow: 0 3px 9px rgba(0,0,0,0.65); touch-action: none;
        }
        #mc-zpad {
            display: flex; flex-direction: column; gap: 8px; pointer-events: all;
        }
        #mc-zpad button {
            width: 66px; height: 66px; margin: 0; border: none;
            border-radius: 11px; color: white; cursor: pointer;
            box-shadow: 0 3px 9px rgba(0,0,0,0.65);
            display: flex; flex-direction: column;
            align-items: center; justify-content: center;
            padding: 0; touch-action: none; font-size: 20px;
        }
        #mc-zpad button span.zlabel { font-size: 10px; opacity: 0.85; }
        @media (orientation: landscape) and (max-height: 520px) {
            #mc-wrap { bottom: 4px; padding: 0 10px; }
            #mc-dpad {
                grid-template-columns: repeat(3, 40px);
                grid-template-rows: repeat(3, 40px);
                gap: 4px;
            }
            #mc-dpad button { font-size: 16px; border-radius: 8px; }
            #mc-zpad button { width: 50px; height: 50px; border-radius: 8px; font-size: 15px; }
            #mc-zpad { gap: 5px; }
        }
    `;
    document.head.appendChild(style);

    const wrap = document.createElement('div');
    wrap.id = 'mc-wrap';

    // ── D-pad: X (←/→) and Y (↑/↓) ─────────────────────
    const dpad = document.createElement('div');
    dpad.id = 'mc-dpad';

    const mkBtn = (symbol, color, col, row, dir) => {
        const btn = document.createElement('button');
        btn.textContent = symbol;
        btn.style.cssText = `background:${hexColor(color)};grid-column:${col};grid-row:${row}`;
        btn.addEventListener('touchstart', e => {
            e.preventDefault();
            btn.style.transform = 'scale(0.88)';
            queueDirectionChange(dir);
        }, { passive: false });
        btn.addEventListener('touchend', e => {
            e.preventDefault();
            btn.style.transform = '';
        }, { passive: false });
        dpad.appendChild(btn);
    };

    mkBtn('↑', COLORS.yAxis, 2, 1, { x: 0, y:  1, z: 0 });
    mkBtn('←', COLORS.xAxis, 1, 2, { x: -1, y: 0, z: 0 });
    mkBtn('→', COLORS.xAxis, 3, 2, { x:  1, y: 0, z: 0 });
    mkBtn('↓', COLORS.yAxis, 2, 3, { x: 0, y: -1, z: 0 });

    // ── Z-axis: depth (blue) ──────────────────────────────
    const zPad = document.createElement('div');
    zPad.id = 'mc-zpad';

    const mkZ = (symbol, dir) => {
        const btn = document.createElement('button');
        btn.textContent = symbol;
        btn.style.background = hexColor(COLORS.zAxis);
        btn.addEventListener('touchstart', e => {
            e.preventDefault();
            btn.style.transform = 'scale(0.88)';
            queueDirectionChange(dir);
        }, { passive: false });
        btn.addEventListener('touchend', e => {
            e.preventDefault();
            btn.style.transform = '';
        }, { passive: false });
        zPad.appendChild(btn);
    };

    mkZ('↗', { x: 0, y: 0, z: -1 });
    mkZ('↙', { x: 0, y: 0, z:  1 });

    wrap.appendChild(dpad);
    wrap.appendChild(zPad);
    document.body.appendChild(wrap);
}

function hexColor(hex) {
    return `rgb(${(hex >> 16) & 255},${(hex >> 8) & 255},${hex & 255})`;
}

// ── Touch handlers (canvas: rotate + pinch zoom) ──────────
function onTouchStart(e) {
    e.preventDefault();
    if (e.touches.length === 2) {
        isSingleTouch = false;
        const t1 = e.touches[0], t2 = e.touches[1];
        pinchStartDist   = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        lastPinchCenterX = (t1.clientX + t2.clientX) / 2;
    } else if (e.touches.length === 1) {
        lastTouchX    = e.touches[0].clientX;
        isSingleTouch = true;
    }
}

function onTouchMove(e) {
    e.preventDefault();
    if (e.touches.length === 2) {
        const t1 = e.touches[0], t2 = e.touches[1];

        // Pinch zoom
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        if (pinchStartDist > 5) {
            const ns = Math.max(MIN_SCALE, Math.min(currentScale * (dist / pinchStartDist), MAX_SCALE));
            if (Math.abs(ns - currentScale) > 0.005) {
                currentScale = ns;
                gameGroup.scale.set(currentScale, currentScale, currentScale);
            }
        }
        pinchStartDist = dist;

        // Two-finger pan to rotate
        const cx = (t1.clientX + t2.clientX) / 2;
        const dx = cx - lastPinchCenterX;
        if (Math.abs(dx) > 0.5) {
            currentRotationY += dx * 0.01;
            gameGroup.rotation.y = currentRotationY;
            lastPinchCenterX = cx;
        }
        saveSettings();

    } else if (isSingleTouch && e.touches.length === 1) {
        const dx = e.touches[0].clientX - lastTouchX;
        if (Math.abs(dx) > 0.5) {
            currentRotationY += dx * 0.01;
            gameGroup.rotation.y = currentRotationY;
            lastTouchX = e.touches[0].clientX;
            saveSettings();
        }
    }
}

function onTouchEnd(e) {
    e.preventDefault();
    if (e.touches.length < 2) pinchStartDist = 0;
    if (e.touches.length === 0) isSingleTouch = false;
}

// ── Direction queue ───────────────────────────────────────
function queueDirectionChange(newDir) {
    // Cannot reverse into self
    if ((direction.x !== 0 && newDir.x === -direction.x) ||
        (direction.y !== 0 && newDir.y === -direction.y) ||
        (direction.z !== 0 && newDir.z === -direction.z)) return false;

    const last = directionQueue.length ? directionQueue[directionQueue.length - 1] : nextDirection;
    if (last.x === newDir.x && last.y === newDir.y && last.z === newDir.z) return false;

    directionQueue.push(newDir);
    if (directionQueue.length === 1) nextDirection = newDir;
    return true;
}

// ── Keyboard ──────────────────────────────────────────────
function handleKeyPress(e) {
    if (e.key === 'Enter' && isGameOver) { restartGame(); return; }

    if ((e.key === 'p' || e.key === 'P' || e.key === ' ') && !isGameOver) {
        e.preventDefault();
        togglePause();
        return;
    }

    if (isPaused || isGameOver) return;

    const dirs = {
        ArrowLeft:  { x: -1, y:  0, z:  0 },
        ArrowRight: { x:  1, y:  0, z:  0 },
        w:          { x:  0, y:  1, z:  0 },
        W:          { x:  0, y:  1, z:  0 },
        s:          { x:  0, y: -1, z:  0 },
        S:          { x:  0, y: -1, z:  0 },
        ArrowUp:    { x:  0, y:  0, z: -1 },
        ArrowDown:  { x:  0, y:  0, z:  1 },
    };

    if (dirs[e.key]) { e.preventDefault(); queueDirectionChange(dirs[e.key]); }
}

// ── Move snake ────────────────────────────────────────────
function moveSnake() {
    if (isGameOver || isPaused) return;

    if (directionQueue.length > 0) nextDirection = directionQueue.shift();
    direction = { ...nextDirection };

    const head = snake[0];
    const newPos = {
        x: head.position.x + direction.x * UNIT_SIZE,
        y: head.position.y + direction.y * UNIT_SIZE,
        z: head.position.z + direction.z * UNIT_SIZE,
    };

    // ── Boundary check ──────────────────────────────────
    // Valid positions: 0 to GRID_SIZE*UNIT_SIZE (snake can touch all 6 walls)
    const maxPos = GRID_SIZE * UNIT_SIZE;
    const eps    = UNIT_SIZE * 0.05;
    if (newPos.x < -eps || newPos.x > maxPos + eps ||
        newPos.y < -eps || newPos.y > maxPos + eps ||
        newPos.z < -eps || newPos.z > maxPos + eps) {
        gameOver();
        return;
    }

    // Snap to grid to eliminate float drift
    newPos.x = Math.round(newPos.x / UNIT_SIZE) * UNIT_SIZE;
    newPos.y = Math.round(newPos.y / UNIT_SIZE) * UNIT_SIZE;
    newPos.z = Math.round(newPos.z / UNIT_SIZE) * UNIT_SIZE;

    // ── Self-collision (exclude tail — it's about to move) ──
    for (let i = 0; i < snake.length - 1; i++) {
        if (posEqual(snake[i].position, newPos)) { gameOver(); return; }
    }

    // ── Food ────────────────────────────────────────────
    const eating = posEqual(food.position, newPos);

    // Add new head
    const seg = new THREE.Mesh(
        new THREE.BoxGeometry(UNIT_SIZE * 0.9, UNIT_SIZE * 0.9, UNIT_SIZE * 0.9),
        new THREE.MeshBasicMaterial({ color: COLORS.snake })
    );
    seg.position.set(newPos.x, newPos.y, newPos.z);
    gameGroup.add(seg);
    snake.unshift({ mesh: seg, position: { ...newPos } });

    if (eating) {
        score += 10;
        scoreBoard.textContent = `Score: ${score}`;
        createFood();
    } else {
        const tail = snake.pop();
        gameGroup.remove(tail.mesh);
    }
}

// ── Game over / restart ───────────────────────────────────
function gameOver() {
    isGameOver = true;
    clearInterval(moveTimer);
    moveTimer = null;
    if (pauseButton) pauseButton.textContent = '||';
    finalScore.textContent = `Your score: ${score}`;
    gameOverScreen.style.display = 'flex';
}

function restartGame() {
    score = 0; isGameOver = false; isPaused = false;
    direction = nextDirection = { x: 1, y: 0, z: 0 };
    directionQueue = [];
    if (pauseButton) pauseButton.textContent = '||';

    snake.forEach(s => gameGroup.remove(s.mesh));
    if (food) gameGroup.remove(food.mesh);
    snake = [];

    gameOverScreen.style.display = 'none';
    scoreBoard.textContent = 'Score: 0';

    createSnake();
    createFood();

    clearInterval(moveTimer);
    moveTimer = setInterval(moveSnake, MOVE_INTERVAL);
}

// ── Resize / render / save ────────────────────────────────
function handleResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
}

function saveSettings() {
    try {
        localStorage.setItem('snake3dSettings', JSON.stringify({
            rotation: currentRotationY,
            scale: currentScale
        }));
    } catch (_) {}
}

// ── Start ─────────────────────────────────────────────────
window.onload = init;
