const Material = {
  EMPTY: 0,
  SAND: 1,
  WATER: 2,
  SMOKE: 3,
  STONE: 4,
  FIRE: 5,
  OIL: 6,
  ICE: 7,
  LAVA: 8,
  BALL: 9,
};

const MATERIAL_ORDER = [
  Material.SAND,
  Material.WATER,
  Material.SMOKE,
  Material.STONE,
  Material.FIRE,
  Material.OIL,
  Material.ICE,
  Material.LAVA,
  Material.BALL,
];

const KEY_TO_MATERIAL = {
  1: Material.SAND,
  2: Material.WATER,
  3: Material.SMOKE,
  4: Material.STONE,
  5: Material.FIRE,
  6: Material.OIL,
  7: Material.ICE,
  8: Material.LAVA,
  9: Material.BALL,
};

const MATERIAL_META = {
  [Material.SAND]: { name: "Sand (1)", color: [215, 191, 126], density: 4.0 },
  [Material.WATER]: { name: "Water (2)", color: [96, 155, 218], density: 2.6 },
  [Material.SMOKE]: { name: "Smoke (3)", color: [148, 153, 164], density: 0.4 },
  [Material.STONE]: { name: "Stone (4)", color: [119, 123, 129], density: 9.0 },
  [Material.FIRE]: { name: "Fire (5)", color: [239, 130, 70], density: 0.6 },
  [Material.OIL]: { name: "Oil (6)", color: [134, 106, 71], density: 2.2 },
  [Material.ICE]: { name: "Ice (7)", color: [190, 230, 255], density: 9.0 },
  [Material.LAVA]: { name: "Lava (8)", color: [220, 70, 15], density: 6.0 },
  [Material.BALL]: { name: "Ball (9)", color: [255, 80, 100], density: 5.5 },
};

const FLOOR_ROWS = 2;

const canvas = document.getElementById("sandbox");
const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
const materialControls = document.getElementById("materialControls");
const brushSizeInput = document.getElementById("brushSize");
const brushSizeValue = document.getElementById("brushSizeValue");
const simSpeedInput = document.getElementById("simSpeed");
const simSpeedValue = document.getElementById("simSpeedValue");
const fontSizeSmallBtn = document.getElementById("fontSizeSmall");
const fontSizeMediumBtn = document.getElementById("fontSizeMedium");
const fontSizeLargeBtn = document.getElementById("fontSizeLarge");
const clearBtn = document.getElementById("clearBtn");
const muteBtn = document.getElementById("muteBtn");

let simScale = 2;
let simWidth = 0;
let simHeight = 0;
let cells = new Uint8Array(0);
let life = new Uint8Array(0);
let fireState = new Uint8Array(0);
let waterSideAttempts = new Uint8Array(0);
let waterSleepVersion = new Uint16Array(0);
let updated = new Uint8Array(0);
let frameImage = null;
let frameData = null;
const renderSurface = document.createElement("canvas");
const renderSurfaceCtx = renderSurface.getContext("2d", { alpha: false });
let paused = false;
let isMuted = false;
let activeMaterial = Material.SAND;
let brushRadius = Number(brushSizeInput.value);
let speedMultiplier = Number(simSpeedInput.value);
let pointerDown = false;
let eraseMode = false;
let pointerSimX = 0;
let pointerSimY = 0;
let prevPaintX = null;
let prevPaintY = null;
let frameParity = 0;
let lastSpokenMaterial = "";
let lastSpokenAt = 0;
let activeBalls = [];

const BALL_RADIUS = 4;
const BALL_GRAVITY = 0.16;
const BALL_BOUNCE = 0.55;
const MAX_BALLS = 7;
const WATER_MAX_SIDE_ATTEMPTS = 7;
const WATER_IDLE_FREEZE_MS = 8000;
let waterWakeVersion = 1;
let lastDrawActivityAt = performance.now();

let randSeed = 0x1234abcd;
function rand() {
  randSeed ^= randSeed << 13;
  randSeed ^= randSeed >> 17;
  randSeed ^= randSeed << 5;
  return (randSeed >>> 0) / 4294967296;
}

function idx(x, y) {
  return y * simWidth + x;
}

function inBounds(x, y) {
  return x >= 0 && y >= 0 && x < simWidth && y < simHeight;
}

function signalWaterWake() {
  lastDrawActivityAt = performance.now();
  waterWakeVersion = (waterWakeVersion + 1) & 0xffff;
  if (waterWakeVersion === 0) {
    waterWakeVersion = 1;
  }
}

function sampleCellAt(x, y) {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  if (!inBounds(cx, cy)) {
    return Material.STONE;
  }
  return cells[idx(cx, cy)];
}

function isBallBlockingMaterial(mat) {
  return mat === Material.SAND || mat === Material.STONE;
}

function ballTouchesBlocking(x, y, radius) {
  const xMin = Math.floor(x - radius);
  const xMax = Math.floor(x + radius);
  const yMin = Math.floor(y - radius);
  const yMax = Math.floor(y + radius);

  for (let cy = yMin; cy <= yMax; cy++) {
    for (let cx = xMin; cx <= xMax; cx++) {
      if (!inBounds(cx, cy)) {
        return true;
      }
      const dx = cx + 0.5 - x;
      const dy = cy + 0.5 - y;
      if (dx * dx + dy * dy > radius * radius) {
        continue;
      }
      const mat = cells[idx(cx, cy)];
      if (isBallBlockingMaterial(mat)) {
        return true;
      }
    }
  }

  return false;
}

function ballWaterRatio(x, y, radius) {
  const samples = [
    [0, radius * 0.8],
    [-radius * 0.35, radius * 0.55],
    [radius * 0.35, radius * 0.55],
    [0, radius * 0.3],
    [0, 0],
  ];

  let waterCount = 0;
  for (let i = 0; i < samples.length; i++) {
    const [sx, sy] = samples[i];
    if (sampleCellAt(x + sx, y + sy) === Material.WATER) {
      waterCount += 1;
    }
  }

  return waterCount / samples.length;
}

function spawnSingleBall(x, y) {
  if (!inBounds(x, y)) {
    return false;
  }

  const spawnMaterial = cells[idx(x, y)];
  if (spawnMaterial === Material.SAND || spawnMaterial === Material.STONE) {
    return false;
  }

  const candidate = {
    x: x + 0.5,
    y: y + 0.5,
    vx: 0,
    vy: 0,
    r: BALL_RADIUS,
  };

  if (ballTouchesBlocking(candidate.x, candidate.y, candidate.r)) {
    return false;
  }

  if (activeBalls.length >= MAX_BALLS) {
    activeBalls.shift();
  }
  activeBalls.push(candidate);
  return true;
}

function moveBallAxis(ball, axis, delta) {
  if (!ball || delta === 0) {
    return;
  }

  const steps = Math.max(1, Math.ceil(Math.abs(delta) / 0.25));
  const step = delta / steps;

  for (let i = 0; i < steps; i++) {
    const nx = axis === "x" ? ball.x + step : ball.x;
    const ny = axis === "y" ? ball.y + step : ball.y;

    if (ballTouchesBlocking(nx, ny, ball.r)) {
      if (axis === "x") {
        ball.vx *= -BALL_BOUNCE;
      } else {
        if (delta > 0) {
          // Downward collision: stop vertical speed so gravity drives the next fall naturally.
          ball.vy = 0;
        } else {
          ball.vy *= -BALL_BOUNCE;
          if (Math.abs(ball.vy) < 0.08) {
            ball.vy = 0;
          }
        }
      }
      return;
    }

    ball.x = nx;
    ball.y = ny;
  }
}

function tryBallSlideDown(ball) {
  const directions = rand() < 0.5 ? [-1, 1] : [1, -1];
  const sideSteps = [0.45, 0.8, 1.1];

  for (let d = 0; d < directions.length; d++) {
    const dir = directions[d];
    for (let s = 0; s < sideSteps.length; s++) {
      const nx = ball.x + dir * sideSteps[s];
      const ny = ball.y + 0.45;
      if (!ballTouchesBlocking(nx, ny, ball.r)) {
        ball.x = nx;
        ball.y = ny;
        ball.vx = clamp(ball.vx + dir * 0.12, -1.8, 1.8);
        ball.vy = 0.12;
        return true;
      }
    }
  }

  return false;
}

function updateBallPhysics() {
  if (activeBalls.length === 0) {
    return;
  }

  for (let i = 0; i < activeBalls.length; i++) {
    const ball = activeBalls[i];

    ball.vy += BALL_GRAVITY;

    const waterRatio = ballWaterRatio(ball.x, ball.y, ball.r);
    if (waterRatio > 0) {
      ball.vy -= 0.3 * waterRatio;
      ball.vx *= 0.99;
      ball.vy *= 0.96;
    }

    ball.vx *= 0.995;
    ball.vx = clamp(ball.vx, -1.8, 1.8);
    ball.vy = clamp(ball.vy, -2.6, 2.6);

    const vyBeforeMove = ball.vy;
    moveBallAxis(ball, "x", ball.vx);
    moveBallAxis(ball, "y", ball.vy);

    if (vyBeforeMove > 0.05 && ball.vy === 0) {
      tryBallSlideDown(ball);
    }

    if (ball.x < ball.r) {
      ball.x = ball.r;
      ball.vx = Math.abs(ball.vx) * BALL_BOUNCE;
    } else if (ball.x > simWidth - 1 - ball.r) {
      ball.x = simWidth - 1 - ball.r;
      ball.vx = -Math.abs(ball.vx) * BALL_BOUNCE;
    }

    if (ball.y < ball.r) {
      ball.y = ball.r;
      ball.vy = Math.abs(ball.vy) * BALL_BOUNCE;
    } else if (ball.y > simHeight - 1 - ball.r) {
      ball.y = simHeight - 1 - ball.r;
      ball.vy = -Math.abs(ball.vy) * BALL_BOUNCE;
    }
  }
}

function resize() {
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);

  const oldWidth = simWidth;
  const oldHeight = simHeight;
  const oldCells = cells;
  const oldLife = life;
  const oldFireState = fireState;

  const w = Math.floor(window.innerWidth);
  const h = Math.floor(window.innerHeight);
  simScale = w >= 1500 ? 3 : 2;
  simWidth = Math.max(120, Math.floor(w / simScale));
  simHeight = Math.max(80, Math.floor(h / simScale));

  const nextCells = new Uint8Array(simWidth * simHeight);
  const nextLife = new Uint8Array(simWidth * simHeight);
  const nextFireState = new Uint8Array(simWidth * simHeight);
  const nextWaterSideAttempts = new Uint8Array(simWidth * simHeight);
  const nextWaterSleepVersion = new Uint16Array(simWidth * simHeight);
  updated = new Uint8Array(simWidth * simHeight);

  if (oldWidth > 0 && oldHeight > 0) {
    const copyWidth = Math.min(oldWidth, simWidth);
    const copyHeight = Math.min(oldHeight, simHeight);
    const srcOffsetX = Math.floor((oldWidth - copyWidth) / 2);
    const srcOffsetY = Math.floor((oldHeight - copyHeight) / 2);
    const dstOffsetX = Math.floor((simWidth - copyWidth) / 2);
    const dstOffsetY = Math.floor((simHeight - copyHeight) / 2);

    for (let y = 0; y < copyHeight; y++) {
      const srcY = y + srcOffsetY;
      const dstY = y + dstOffsetY;
      for (let x = 0; x < copyWidth; x++) {
        const srcX = x + srcOffsetX;
        const dstX = x + dstOffsetX;
        const srcI = srcY * oldWidth + srcX;
        const dstI = dstY * simWidth + dstX;
        nextCells[dstI] = oldCells[srcI];
        nextLife[dstI] = oldLife[srcI];
        nextFireState[dstI] = oldFireState[srcI];
      }
    }
  }

  cells = nextCells;
  life = nextLife;
  fireState = nextFireState;
  waterSideAttempts = nextWaterSideAttempts;
  waterSleepVersion = nextWaterSleepVersion;
  frameImage = new ImageData(simWidth, simHeight);
  frameData = frameImage.data;
  renderSurface.width = simWidth;
  renderSurface.height = simHeight;
  seedFloor();
}

function seedFloor() {
  const startY = Math.max(0, simHeight - FLOOR_ROWS);
  for (let y = startY; y < simHeight; y++) {
    for (let x = 0; x < simWidth; x++) {
      const i = idx(x, y);
      cells[i] = Material.STONE;
      life[i] = 0;
      fireState[i] = 0;
    }
  }
}

function moveCell(from, to) {
  cells[to] = cells[from];
  life[to] = life[from];
  fireState[to] = fireState[from];
  cells[from] = Material.EMPTY;
  life[from] = 0;
  fireState[from] = 0;
  updated[to] = 1;
  updated[from] = 1;
}

function swapCells(a, b) {
  const mat = cells[a];
  const li = life[a];
  const fi = fireState[a];
  cells[a] = cells[b];
  life[a] = life[b];
  fireState[a] = fireState[b];
  cells[b] = mat;
  life[b] = li;
  fireState[b] = fi;
  updated[a] = 1;
  updated[b] = 1;
}

function tryWaterPushOilUp(waterIndex, oilIndex, oilX, oilY) {
  if (oilY <= 0) {
    return false;
  }

  const up = idx(oilX, oilY - 1);
  const upMat = cells[up];
  if (upMat !== Material.EMPTY && upMat !== Material.SMOKE && upMat !== Material.FIRE) {
    return false;
  }

  cells[up] = Material.OIL;
  life[up] = 0;
  fireState[up] = 0;

  cells[oilIndex] = Material.WATER;
  life[oilIndex] = life[waterIndex];
  fireState[oilIndex] = 0;

  cells[waterIndex] = Material.EMPTY;
  life[waterIndex] = 0;
  fireState[waterIndex] = 0;

  updated[up] = 1;
  updated[oilIndex] = 1;
  updated[waterIndex] = 1;
  return true;
}

function density(mat) {
  return mat === Material.EMPTY ? 0 : MATERIAL_META[mat].density;
}

function canDisplace(fromMat, toMat) {
  if (toMat === Material.STONE) {
    return false;
  }
  return density(fromMat) > density(toMat);
}

function igniteAt(i) {
  if (cells[i] === Material.OIL || cells[i] === Material.SMOKE) {
    cells[i] = Material.FIRE;
    life[i] = 20 + Math.floor(rand() * 30);
    fireState[i] = 0;
    updated[i] = 1;
  }
}

function spawnFlameAt(x, y, minLife = 16, maxLife = 32) {
  if (!inBounds(x, y)) {
    return;
  }
  const i = idx(x, y);
  const mat = cells[i];
  if (mat !== Material.EMPTY && mat !== Material.SMOKE) {
    return;
  }
  cells[i] = Material.FIRE;
  life[i] = minLife + Math.floor(rand() * (maxLife - minLife + 1));
  fireState[i] = 0;
  updated[i] = 1;
}

function igniteOilWithFlames(i) {
  if (cells[i] !== Material.OIL) {
    return;
  }

  igniteAt(i);

  const x = i % simWidth;
  const y = Math.floor(i / simWidth);
  spawnFlameAt(x, y - 1, 16, 30);
  spawnFlameAt(x, y - 2, 12, 24);

  if (rand() < 0.95) {
    spawnFlameAt(x + (rand() < 0.5 ? -1 : 1), y - 1, 12, 24);
  }

  if (rand() < 0.8) {
    spawnFlameAt(x + (rand() < 0.5 ? -1 : 1), y, 10, 20);
  }

  if (rand() < 0.7) {
    spawnFlameAt(x + (rand() < 0.5 ? -1 : 1), y - 2, 10, 20);
  }

  if (rand() < 0.45) {
    spawnFlameAt(x, y - 3, 8, 16);
  }
}

function updateSand(x, y, i) {
  const belowY = y + 1;
  if (belowY >= simHeight) {
    updated[i] = 1;
    return;
  }

  const below = idx(x, belowY);
  const matBelow = cells[below];
  if (canDisplace(Material.SAND, matBelow) && matBelow !== Material.FIRE) {
    if (matBelow === Material.EMPTY) {
      moveCell(i, below);
    } else {
      swapCells(i, below);
    }
    return;
  }

  const dir = rand() < 0.5 ? -1 : 1;
  for (let step = 0; step < 2; step++) {
    const dx = step === 0 ? dir : -dir;
    const nx = x + dx;
    const ny = y + 1;
    if (!inBounds(nx, ny)) {
      continue;
    }
    const ni = idx(nx, ny);
    const target = cells[ni];
    if (canDisplace(Material.SAND, target) && target !== Material.FIRE) {
      if (target === Material.EMPTY) {
        moveCell(i, ni);
      } else {
        swapCells(i, ni);
      }
      return;
    }
  }

  updated[i] = 1;
}

function updateBall(x, y, i) {
  const belowY = y + 1;
  if (belowY >= simHeight) {
    updated[i] = 1;
    return;
  }

  const below = idx(x, belowY);
  const matBelow = cells[below];
  if (canDisplace(Material.BALL, matBelow) && matBelow !== Material.FIRE) {
    if (matBelow === Material.EMPTY) {
      moveCell(i, below);
    } else {
      swapCells(i, below);
    }
    return;
  }

  // Balls roll more easily than sand
  const dir = rand() < 0.5 ? -1 : 1;
  const lateralSpread = 4; // Can roll further than sand
  for (let sideTry = 0; sideTry < 2; sideTry++) {
    const sideDir = sideTry === 0 ? dir : -dir;
    for (let spread = 1; spread <= lateralSpread; spread++) {
      const nx = x + sideDir * spread;
      const ny = y + 1;
      if (!inBounds(nx, ny)) {
        continue;
      }
      const ni = idx(nx, ny);
      const target = cells[ni];
      if (canDisplace(Material.BALL, target) && target !== Material.FIRE) {
        if (target === Material.EMPTY) {
          moveCell(i, ni);
        } else {
          swapCells(i, ni);
        }
        return;
      }
      if (target === Material.STONE || target === Material.SAND) {
        break;
      }
    }
  }

  updated[i] = 1;
}

function updateWater(x, y, i) {
  if (performance.now() - lastDrawActivityAt >= WATER_IDLE_FREEZE_MS) {
    updated[i] = 1;
    return;
  }

  if (waterSleepVersion[i] === waterWakeVersion) {
    updated[i] = 1;
    return;
  }
  if (waterSleepVersion[i] !== 0) {
    waterSleepVersion[i] = 0;
    waterSideAttempts[i] = 0;
  }

  const downY = y + 1;
  if (downY < simHeight) {
    const down = idx(x, downY);
    const target = cells[down];
    if (target === Material.EMPTY || target === Material.SMOKE || target === Material.FIRE || target === Material.OIL) {
      if (target === Material.EMPTY) {
        moveCell(i, down);
      } else {
        swapCells(i, down);
      }
      waterSideAttempts[down] = 0;
      waterSleepVersion[down] = 0;
      return;
    }
  }

  const hasOilAbove =
    y > 0 &&
    (cells[idx(x, y - 1)] === Material.OIL ||
      (x > 0 && cells[idx(x - 1, y - 1)] === Material.OIL) ||
      (x + 1 < simWidth && cells[idx(x + 1, y - 1)] === Material.OIL));
  const hasOilSide =
    (x > 0 && cells[idx(x - 1, y)] === Material.OIL) ||
    (x + 1 < simWidth && cells[idx(x + 1, y)] === Material.OIL);
  const cappedByOil = hasOilAbove || hasOilSide;
  const lateralSpread = cappedByOil ? 9 : 3;

  if (cappedByOil) {
    const dir = rand() < 0.5 ? -1 : 1;
    for (let sideTry = 0; sideTry < 2; sideTry++) {
      const sideDir = sideTry === 0 ? dir : -dir;
      for (let spread = 1; spread <= lateralSpread; spread++) {
        const nx = x + sideDir * spread;
        if (!inBounds(nx, y)) {
          break;
        }
        const ni = idx(nx, y);
        const target = cells[ni];
        if (target === Material.EMPTY || target === Material.SMOKE || target === Material.FIRE || target === Material.OIL) {
          if (target === Material.EMPTY) {
            moveCell(i, ni);
          } else if (target === Material.OIL) {
            if (!tryWaterPushOilUp(i, ni, nx, y)) {
              swapCells(i, ni);
            }
          } else {
            swapCells(i, ni);
          }
          waterSideAttempts[ni] = 0;
          waterSleepVersion[ni] = 0;
          return;
        }
        if (target === Material.STONE || target === Material.SAND) {
          break;
        }
      }
    }
  }

  const dir = rand() < 0.5 ? -1 : 1;
  for (let step = 0; step < 2; step++) {
    const dx = step === 0 ? dir : -dir;
    const nx = x + dx;
    const ny = y + 1;
    if (!inBounds(nx, ny)) {
      continue;
    }
    const ni = idx(nx, ny);
    const target = cells[ni];
    if (target === Material.EMPTY || target === Material.SMOKE || target === Material.FIRE) {
      if (target === Material.EMPTY) {
        moveCell(i, ni);
      } else {
        swapCells(i, ni);
      }
      waterSideAttempts[ni] = 0;
      waterSleepVersion[ni] = 0;
      return;
    }
  }

  for (let sideTry = 0; sideTry < 2; sideTry++) {
    const sideDir = sideTry === 0 ? dir : -dir;
    for (let spread = 1; spread <= lateralSpread; spread++) {
      const nx = x + sideDir * spread;
      if (!inBounds(nx, y)) {
        break;
      }
      const ni = idx(nx, y);
      const target = cells[ni];
      if (target === Material.EMPTY || target === Material.SMOKE || target === Material.FIRE || target === Material.OIL) {
        if (target === Material.EMPTY) {
          moveCell(i, ni);
        } else if (target === Material.OIL) {
          if (!tryWaterPushOilUp(i, ni, nx, y)) {
            swapCells(i, ni);
          }
        } else {
          swapCells(i, ni);
        }
        waterSideAttempts[ni] = 0;
        waterSleepVersion[ni] = 0;
        return;
      }
      if (target === Material.STONE || target === Material.SAND) {
        break;
      }
    }
  }

  waterSideAttempts[i] = Math.min(255, waterSideAttempts[i] + 1);
  if (waterSideAttempts[i] >= WATER_MAX_SIDE_ATTEMPTS) {
    waterSleepVersion[i] = waterWakeVersion;
  }
  updated[i] = 1;
}

function updateOil(x, y, i) {
  const downY = y + 1;
  let floatingOnWater = false;
  if (downY < simHeight) {
    const down = idx(x, downY);
    const target = cells[down];
    if (target === Material.EMPTY || target === Material.SMOKE) {
      if (target === Material.EMPTY) {
        moveCell(i, down);
      } else {
        swapCells(i, down);
      }
      return;
    }
    floatingOnWater = target === Material.WATER;
  }

  const settleChance = floatingOnWater ? 0.16 : 0.58;
  if (rand() < settleChance) {
    updated[i] = 1;
    return;
  }

  const dir = rand() < 0.5 ? -1 : 1;
  const lateralSpread = floatingOnWater ? 4 : 2;
  for (let sideTry = 0; sideTry < 2; sideTry++) {
    const sideDir = sideTry === 0 ? dir : -dir;
    for (let spread = 1; spread <= lateralSpread; spread++) {
      const nx = x + sideDir * spread;
      if (!inBounds(nx, y)) {
        break;
      }
      const ni = idx(nx, y);
      const target = cells[ni];

      if (target === Material.EMPTY || target === Material.SMOKE) {
        let supportOk = true;
        if (floatingOnWater && y + 1 < simHeight) {
          const belowSide = cells[idx(nx, y + 1)];
          supportOk = belowSide === Material.WATER || belowSide === Material.OIL || belowSide === Material.STONE || belowSide === Material.SAND;
        }

        if (supportOk) {
          if (target === Material.EMPTY) {
            moveCell(i, ni);
          } else {
            swapCells(i, ni);
          }
          return;
        }
      }

      if (target === Material.STONE || target === Material.SAND) {
        break;
      }
    }
  }

  updated[i] = 1;
}

function updateSmoke(x, y, i) {
  // Check if smoke is blocked above by stone — if so, freeze life so it persists
  const blockedByStone =
    (y === 0 || cells[idx(x, y - 1)] === Material.STONE) &&
    (!inBounds(x - 1, y - 1) || cells[idx(x - 1, y - 1)] === Material.STONE) &&
    (!inBounds(x + 1, y - 1) || cells[idx(x + 1, y - 1)] === Material.STONE);

  if (!blockedByStone) {
    if (life[i] > 0) {
      life[i] -= 1;
    }
    if (life[i] === 0 && rand() < 0.18) {
      cells[i] = Material.EMPTY;
      updated[i] = 1;
      return;
    }
  }

  const upY = y - 1;
  if (upY >= 0) {
    const up = idx(x, upY);
    const target = cells[up];
    if (target === Material.EMPTY || target === Material.FIRE) {
      moveCell(i, up);
      return;
    }
  }

  const dir = rand() < 0.5 ? -1 : 1;
  for (let step = 0; step < 2; step++) {
    const nx = x + (step === 0 ? dir : -dir);
    if (!inBounds(nx, y - 1)) {
      continue;
    }
    const ni = idx(nx, y - 1);
    const target = cells[ni];
    if (target === Material.EMPTY || target === Material.FIRE) {
      moveCell(i, ni);
      return;
    }
  }

  updated[i] = 1;
}

function updateFire(x, y, i) {
  if (life[i] > 0) {
    life[i] -= 1;
  }

  if (y + 1 < simHeight) {
    const below = idx(x, y + 1);
    if (cells[below] === Material.WATER) {
      cells[i] = Material.SMOKE;
      life[i] = 22 + Math.floor(rand() * 20);
      fireState[i] = 0;
      updated[i] = 1;
      return;
    }
  }

  const wetFire = fireState[i] === 1;

  const neighbors = [
    [x, y - 1],
    [x + 1, y],
    [x - 1, y],
    [x, y + 1],
    [x + 1, y - 1],
    [x - 1, y - 1],
  ];

  for (let n = 0; n < neighbors.length; n++) {
    const [nx, ny] = neighbors[n];
    if (!inBounds(nx, ny)) {
      continue;
    }
    const ni = idx(nx, ny);
    if (!wetFire && cells[ni] === Material.OIL && rand() < 0.3) {
      igniteOilWithFlames(ni);
    }
    if (cells[ni] === Material.WATER && rand() < 0.35) {
      cells[ni] = Material.SMOKE;
      life[ni] = 12 + Math.floor(rand() * 18);
      fireState[ni] = 0;
      updated[ni] = 1;
    }
  }

  if (life[i] === 0) {
    cells[i] = Material.SMOKE;
    life[i] = 25 + Math.floor(rand() * 35);
    fireState[i] = 0;
    updated[i] = 1;
    return;
  }

  if (y > 0 && rand() < 0.28) {
    const up = idx(x, y - 1);
    if (cells[up] === Material.EMPTY || cells[up] === Material.SMOKE) {
      moveCell(i, up);
      return;
    }
  }

  if (rand() < 0.08) {
    const side = x + (rand() < 0.5 ? -1 : 1);
    if (inBounds(side, y)) {
      const si = idx(side, y);
      if (cells[si] === Material.EMPTY) {
        moveCell(i, si);
        return;
      }
    }
  }

  updated[i] = 1;
}

function updateIce(x, y, i) {
  // Melt when adjacent to fire or lava
  const neighbors4 = [[x, y - 1], [x, y + 1], [x - 1, y], [x + 1, y]];
  for (let n = 0; n < neighbors4.length; n++) {
    const [nx, ny] = neighbors4[n];
    if (!inBounds(nx, ny)) continue;
    const ni = idx(nx, ny);
    const mat = cells[ni];
    if ((mat === Material.FIRE || mat === Material.LAVA) && rand() < 0.05) {
      cells[i] = Material.WATER;
      life[i] = 0;
      fireState[i] = 0;
      updated[i] = 1;
      return;
    }
    // Slowly freeze adjacent water
    if (mat === Material.WATER && rand() < 0.005) {
      cells[ni] = Material.ICE;
      life[ni] = 0;
      fireState[ni] = 0;
      updated[ni] = 1;
    }
  }

  // Buoyancy: if submerged, ice rises through water.
  if (y > 0) {
    const up = idx(x, y - 1);
    if (cells[up] === Material.WATER) {
      swapCells(i, up);
      return;
    }
  }

  // Fall straight down
  const belowY = y + 1;
  if (belowY < simHeight) {
    const below = idx(x, belowY);
    const matBelow = cells[below];
    if (canDisplace(Material.ICE, matBelow) && matBelow !== Material.FIRE && matBelow !== Material.LAVA && matBelow !== Material.SAND && matBelow !== Material.WATER) {
      if (matBelow === Material.EMPTY) {
        moveCell(i, below);
      } else {
        swapCells(i, below);
      }
      return;
    }
  }

  // Slide diagonally down
  const dir = rand() < 0.5 ? -1 : 1;
  for (let step = 0; step < 2; step++) {
    const dx = step === 0 ? dir : -dir;
    const nx = x + dx;
    const ny = y + 1;
    if (!inBounds(nx, ny)) continue;
    const ni = idx(nx, ny);
    const target = cells[ni];
    if (canDisplace(Material.ICE, target) && target !== Material.FIRE && target !== Material.LAVA && target !== Material.SAND && target !== Material.WATER) {
      if (target === Material.EMPTY) {
        moveCell(i, ni);
      } else {
        swapCells(i, ni);
      }
      return;
    }
  }

  updated[i] = 1;
}

function updateLava(x, y, i) {
  const lavaAge = life[i] + fireState[i] * 256;
  const nextAge = Math.min(lavaAge + 1, 3600);
  life[i] = nextAge & 255;
  fireState[i] = nextAge >> 8;

  if (lavaAge > 1500) {
    const coolingProgress = Math.min(1, (lavaAge - 1500) / 2100);
    if (rand() < 0.002 + coolingProgress * 0.028) {
      cells[i] = Material.STONE;
      life[i] = 0;
      fireState[i] = 0;
      updated[i] = 1;
      return;
    }
  }

  if (lavaAge >= 3600) {
    cells[i] = Material.STONE;
    life[i] = 0;
    fireState[i] = 0;
    updated[i] = 1;
    return;
  }

  // React with neighbors
  const neighbors4 = [[x, y - 1], [x, y + 1], [x - 1, y], [x + 1, y]];
  for (let n = 0; n < neighbors4.length; n++) {
    const [nx, ny] = neighbors4[n];
    if (!inBounds(nx, ny)) continue;
    const ni = idx(nx, ny);
    const mat = cells[ni];
    if (mat === Material.WATER && rand() < 0.25) {
      // Lava cools to stone, water turns to steam
      cells[i] = Material.STONE;
      life[i] = 0;
      fireState[i] = 0;
      cells[ni] = Material.SMOKE;
      life[ni] = 20 + Math.floor(rand() * 25);
      fireState[ni] = 0;
      updated[i] = 1;
      updated[ni] = 1;
      return;
    }
    if (mat === Material.ICE && rand() < 0.2) {
      // Ice melts to water, lava cools to stone
      cells[i] = Material.STONE;
      life[i] = 0;
      fireState[i] = 0;
      cells[ni] = Material.WATER;
      life[ni] = 0;
      fireState[ni] = 0;
      updated[i] = 1;
      updated[ni] = 1;
      return;
    }
    if (mat === Material.OIL && rand() < 0.15) {
      igniteOilWithFlames(ni);
    }
  }

  // Occasionally emit smoke above
  if (y > 0 && rand() < 0.025) {
    const up = idx(x, y - 1);
    if (cells[up] === Material.EMPTY) {
      cells[up] = Material.SMOKE;
      life[up] = 14 + Math.floor(rand() * 18);
      fireState[up] = 0;
      updated[up] = 1;
    }
  }

  // Flow downward (viscous — high settle chance)
  const belowY = y + 1;
  if (belowY < simHeight) {
    const below = idx(x, belowY);
    const matBelow = cells[below];
    if (matBelow === Material.EMPTY || matBelow === Material.SMOKE || matBelow === Material.FIRE) {
      moveCell(i, below);
      return;
    }
    if (matBelow === Material.WATER || matBelow === Material.OIL || matBelow === Material.SAND) {
      swapCells(i, below);
      return;
    }
  }

  if (rand() < 0.55) {
    updated[i] = 1;
    return;
  }

  // Spread diagonally down
  const dir = rand() < 0.5 ? -1 : 1;
  for (let step = 0; step < 2; step++) {
    const dx = step === 0 ? dir : -dir;
    const nx = x + dx;
    const ny = y + 1;
    if (!inBounds(nx, ny)) continue;
    const ni = idx(nx, ny);
    const target = cells[ni];
    if (target === Material.EMPTY || target === Material.SMOKE || target === Material.WATER || target === Material.OIL || target === Material.SAND) {
      if (target === Material.EMPTY) {
        moveCell(i, ni);
      } else {
        swapCells(i, ni);
      }
      return;
    }
  }

  // Spread laterally
  for (let step = 0; step < 2; step++) {
    const dx = step === 0 ? dir : -dir;
    const nx = x + dx;
    if (!inBounds(nx, y)) continue;
    const ni = idx(nx, y);
    const target = cells[ni];
    if (target === Material.EMPTY || target === Material.WATER || target === Material.OIL || target === Material.SAND) {
      if (target === Material.EMPTY) {
        moveCell(i, ni);
      } else {
        swapCells(i, ni);
      }
      return;
    }
  }

  updated[i] = 1;
}

function updateCell(x, y, i) {
  const mat = cells[i];
  if (mat !== Material.WATER) {
    waterSideAttempts[i] = 0;
    waterSleepVersion[i] = 0;
  }
  if (mat === Material.EMPTY || updated[i]) {
    return;
  }

  switch (mat) {
    case Material.SAND:
      updateSand(x, y, i);
      break;
    case Material.WATER:
      updateWater(x, y, i);
      break;
    case Material.SMOKE:
      updateSmoke(x, y, i);
      break;
    case Material.STONE:
      updated[i] = 1;
      break;
    case Material.FIRE:
      updateFire(x, y, i);
      break;
    case Material.OIL:
      updateOil(x, y, i);
      break;
    case Material.ICE:
      updateIce(x, y, i);
      break;
    case Material.LAVA:
      updateLava(x, y, i);
      break;
    case Material.BALL:
      updateBall(x, y, i);
      break;
    default:
      updated[i] = 1;
      break;
  }
}

function simulationStep() {
  updated.fill(0);

  const reverseX = frameParity % 2 === 0;
  frameParity += 1;

  for (let y = simHeight - 1; y >= 0; y--) {
    if (reverseX) {
      for (let x = simWidth - 1; x >= 0; x--) {
        const i = idx(x, y);
        updateCell(x, y, i);
      }
    } else {
      for (let x = 0; x < simWidth; x++) {
        const i = idx(x, y);
        updateCell(x, y, i);
      }
    }
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function drawCircle(cx, cy, radius, material) {
  const r2 = radius * radius;
  const xMin = clamp(Math.floor(cx - radius), 0, simWidth - 1);
  const xMax = clamp(Math.ceil(cx + radius), 0, simWidth - 1);
  const yMin = clamp(Math.floor(cy - radius), 0, simHeight - 1);
  const yMax = clamp(Math.ceil(cy + radius), 0, simHeight - 1);

  for (let y = yMin; y <= yMax; y++) {
    const dy = y - cy;
    for (let x = xMin; x <= xMax; x++) {
      const dx = x - cx;
      if (dx * dx + dy * dy > r2) {
        continue;
      }
      const i = idx(x, y);
      const previousMaterial = cells[i];
      if ((material === Material.WATER || material === Material.OIL || material === Material.SAND || material === Material.ICE) && (cells[i] === Material.STONE || cells[i] === Material.ICE || cells[i] === Material.LAVA)) {
        continue;
      }
      if (material === Material.SMOKE && (cells[i] === Material.STONE || cells[i] === Material.WATER || cells[i] === Material.OIL || cells[i] === Material.SAND || cells[i] === Material.ICE || cells[i] === Material.LAVA)) {
        continue;
      }
      if (material === Material.SAND && (cells[i] === Material.WATER || cells[i] === Material.OIL)) {
        const displaced = cells[i];
        // scan upward to find the first empty cell and push fluid there
        let pushed = false;
        for (let uy = y - 1; uy >= 0; uy--) {
          const uIdx = idx(x, uy);
          if (cells[uIdx] === Material.EMPTY) {
            cells[uIdx] = displaced;
            life[uIdx] = 0;
            fireState[uIdx] = 0;
            pushed = true;
            break;
          } else if (cells[uIdx] !== Material.WATER && cells[uIdx] !== Material.OIL) {
            break; // blocked by solid or other material
          }
        }
        // place sand regardless
      }
      if (material === Material.FIRE && previousMaterial === Material.WATER) {
        cells[i] = Material.SMOKE;
        life[i] = 26 + Math.floor(rand() * 18);
        fireState[i] = 0;
        continue;
      }
      cells[i] = material;
      waterSideAttempts[i] = 0;
      waterSleepVersion[i] = 0;
      if (material === Material.FIRE) {
        life[i] = 20 + Math.floor(rand() * 30);
        fireState[i] = previousMaterial === Material.OIL ? 0 : 1;
      } else if (material === Material.SMOKE) {
        life[i] = 30 + Math.floor(rand() * 40);
        fireState[i] = 0;
      } else {
        life[i] = 0;
        fireState[i] = 0;
      }
    }
  }
}

function paintLine(x0, y0, x1, y1, radius, material) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(Math.abs(dx), Math.abs(dy), 1);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const px = Math.round(x0 + dx * t);
    const py = Math.round(y0 + dy * t);
    drawCircle(px, py, radius, material);
  }
}

function clearAll() {
  cells.fill(Material.EMPTY);
  life.fill(0);
  fireState.fill(0);
  waterSideAttempts.fill(0);
  waterSleepVersion.fill(0);
  activeBalls = [];
  seedFloor();
}

function render() {
  for (let i = 0; i < cells.length; i++) {
    const mat = cells[i];
    const p = i * 4;
    if (mat === Material.EMPTY) {
      frameData[p] = 15;
      frameData[p + 1] = 23;
      frameData[p + 2] = 28;
      frameData[p + 3] = 255;
      continue;
    }

    const base = MATERIAL_META[mat].color;
    let r = base[0];
    let g = base[1];
    let b = base[2];

    if (mat === Material.WATER) {
      const jitter = (rand() - 0.5) * 10;
      r += jitter;
      g += jitter;
      b += 10 + jitter;
    } else if (mat === Material.SMOKE) {
      const fade = Math.min(1, (life[i] + 20) / 60);
      r *= fade;
      g *= fade;
      b *= fade;
    } else if (mat === Material.FIRE) {
      const flicker = 0.75 + rand() * 0.45;
      r *= 1.1 * flicker;
      g *= 0.95 * flicker;
      b *= 0.8 * flicker;
    } else if (mat === Material.OIL) {
      const shimmer = (rand() - 0.5) * 7;
      r += shimmer;
      g += shimmer;
      b += shimmer;
    } else if (mat === Material.ICE) {
      const glint = (rand() - 0.5) * 14;
      r += glint * 0.4;
      g += glint * 0.6;
      b += glint;
    } else if (mat === Material.LAVA) {
      const flicker = 0.8 + rand() * 0.4;
      r = clamp((r * 1.1 * flicker) | 0, 0, 255);
      g = clamp((g * 0.6 * flicker + rand() * 20) | 0, 0, 255);
      b = clamp((b * 0.3) | 0, 0, 255);
    }

    frameData[p] = clamp(r | 0, 0, 255);
    frameData[p + 1] = clamp(g | 0, 0, 255);
    frameData[p + 2] = clamp(b | 0, 0, 255);
    frameData[p + 3] = 255;
  }

  const w = Math.floor(window.innerWidth);
  const h = Math.floor(window.innerHeight);
  const scaleX = w / simWidth;
  const scaleY = h / simHeight;

  ctx.imageSmoothingEnabled = false;
  renderSurfaceCtx.putImageData(frameImage, 0, 0);
  ctx.drawImage(renderSurface, 0, 0, simWidth * scaleX, simHeight * scaleY);

  for (let i = 0; i < activeBalls.length; i++) {
    const ball = activeBalls[i];
    const px = ball.x * scaleX;
    const py = ball.y * scaleY;
    const pr = ball.r * scaleX;
    const base = MATERIAL_META[Material.BALL].color;
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, Math.PI * 2);
    ctx.fillStyle = `rgb(${base[0]}, ${base[1]}, ${base[2]})`;
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  if (pointerDown) {
    const brushPx = brushRadius * scaleX;
    ctx.beginPath();
    ctx.arc(pointerSimX * scaleX, pointerSimY * scaleY, brushPx, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(178, 236, 210, 0.5)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

function animationLoop() {
  if (!paused) {
    for (let i = 0; i < speedMultiplier; i++) {
      simulationStep();
      updateBallPhysics();
    }
  }
  render();
  requestAnimationFrame(animationLoop);
}

function updatePointerFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width;
  const y = (event.clientY - rect.top) / rect.height;
  pointerSimX = clamp(Math.floor(x * simWidth), 0, simWidth - 1);
  pointerSimY = clamp(Math.floor(y * simHeight), 0, simHeight - 1);
}

function paintFromPointer() {
  const targetMaterial = eraseMode ? Material.EMPTY : activeMaterial;

  signalWaterWake();

  if (!eraseMode && targetMaterial === Material.BALL) {
    if (prevPaintX == null || prevPaintY == null) {
      if (spawnSingleBall(pointerSimX, pointerSimY)) {
        playBrushAudio(targetMaterial);
      }
    }
    prevPaintX = pointerSimX;
    prevPaintY = pointerSimY;
    return;
  }

  if (prevPaintX == null || prevPaintY == null) {
    drawCircle(pointerSimX, pointerSimY, brushRadius, targetMaterial);
  } else {
    paintLine(prevPaintX, prevPaintY, pointerSimX, pointerSimY, brushRadius, targetMaterial);
  }
  prevPaintX = pointerSimX;
  prevPaintY = pointerSimY;
  playBrushAudio(targetMaterial);
}

function makeMaterialButton(mat) {
  const btn = document.createElement("button");
  btn.textContent = MATERIAL_META[mat].name;
  btn.dataset.mat = String(mat);
  btn.title = `${MATERIAL_META[mat].name} (${MATERIAL_ORDER.indexOf(mat) + 1})`;
  btn.addEventListener("click", () => {
    activeMaterial = mat;
    refreshMaterialSelection();
    speakMaterialName(MATERIAL_META[mat].name);
  });
  btn.addEventListener("mouseenter", () => {
    if (isMuted) {
      return;
    }
    speakMaterialName(MATERIAL_META[mat].name);
  });
  return btn;
}

function refreshMaterialSelection() {
  const buttons = materialControls.querySelectorAll("button");
  buttons.forEach((btn) => {
    const mat = Number(btn.dataset.mat);
    btn.classList.toggle("active", mat === activeMaterial);
  });
}

MATERIAL_ORDER.forEach((mat) => {
  materialControls.appendChild(makeMaterialButton(mat));
});
refreshMaterialSelection();

brushSizeInput.addEventListener("input", () => {
  brushRadius = Number(brushSizeInput.value);
  brushSizeValue.textContent = String(brushRadius);
});

simSpeedInput.addEventListener("input", () => {
  speedMultiplier = Number(simSpeedInput.value);
  simSpeedValue.textContent = String(speedMultiplier);
});

function setFontSize(scale) {
  document.documentElement.style.fontSize = (16 * scale) + "px";
  
  // Adjust HUD width based on font size
  let hudWidth = "360px";
  if (scale === 1.25) {
    hudWidth = "400px";
  } else if (scale === 1.5) {
    hudWidth = "440px";
  }
  document.documentElement.style.setProperty("--hud-width", hudWidth);
  
  fontSizeSmallBtn.classList.toggle("active", scale === 1);
  fontSizeMediumBtn.classList.toggle("active", scale === 1.25);
  fontSizeLargeBtn.classList.toggle("active", scale === 1.5);
}

fontSizeSmallBtn.addEventListener("click", () => setFontSize(1));
fontSizeMediumBtn.addEventListener("click", () => setFontSize(1.25));
fontSizeLargeBtn.addEventListener("click", () => setFontSize(1.5));

clearBtn.addEventListener("click", () => {
  clearAll();
});

muteBtn.addEventListener("click", () => {
  isMuted = !isMuted;
  muteBtn.textContent = isMuted ? "🔇 Sound is Off (s)" : "🔊 Sound is On (s)";
});

window.addEventListener("keydown", (event) => {
  if (event.code === "Space") {
    event.preventDefault();
    paused = !paused;
    return;
  }

  // Toggle mute on 's' or 'S'
  if (event.key === "s" || event.key === "S") {
    event.preventDefault();
    isMuted = !isMuted;
    muteBtn.textContent = isMuted ? "🔇 Sound is Off (s)" : "🔊 Sound is On (s)";
    return;
  }

  if (event.target instanceof HTMLInputElement) {
    return;
  }

  const mat = KEY_TO_MATERIAL[event.key];
  if (mat != null) {
    activeMaterial = mat;
    refreshMaterialSelection();
    speakMaterialName(MATERIAL_META[mat].name);
  }
});

canvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

canvas.addEventListener("pointerdown", async (event) => {
  canvas.setPointerCapture(event.pointerId);
  pointerDown = true;
  eraseMode = event.button === 2;
  updatePointerFromEvent(event);
  prevPaintX = null;
  prevPaintY = null;
  await ensureAudioRunning();
  paintFromPointer();
});

canvas.addEventListener("pointermove", (event) => {
  updatePointerFromEvent(event);
  if (pointerDown) {
    paintFromPointer();
  }
});

canvas.addEventListener("pointerup", () => {
  pointerDown = false;
  prevPaintX = null;
  prevPaintY = null;
});

canvas.addEventListener("pointerleave", () => {
  if (!pointerDown) {
    prevPaintX = null;
    prevPaintY = null;
  }
});

let audioCtx = null;
let noiseBuffer = null;

function ensureAudio() {
  if (audioCtx) {
    return;
  }
  audioCtx = new AudioContext({ latencyHint: "interactive" });
  noiseBuffer = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.12, audioCtx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * 0.7;
  }
}

async function ensureAudioRunning() {
  ensureAudio();
  if (!audioCtx) {
    return;
  }
  if (audioCtx.state !== "running") {
    try {
      await audioCtx.resume();
    } catch {
      // Ignore resume failure; play path below will safely no-op.
    }
  }
}

function playNoiseLayer(type, freq, q, peak, attack, decay) {
  if (isMuted) return;
  
  const now = audioCtx.currentTime;
  const source = audioCtx.createBufferSource();
  source.buffer = noiseBuffer;

  const filter = audioCtx.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(freq, now);
  filter.Q.setValueAtTime(q, now);

  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(peak, now + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + decay);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(audioCtx.destination);

  source.start(now);
  source.stop(now + decay + 0.04);
}

function playWaterPourSound() {
  // Liquid splash: low-mid body + light upper texture
  playNoiseLayer("bandpass", 560, 0.75, 0.018, 0.010, 0.20);
  playNoiseLayer("highpass", 1350, 0.6, 0.008, 0.008, 0.14);
}

function playOilPourSound() {
  // Dark/viscous: deeper, duller than water
  playNoiseLayer("lowpass", 420, 1.1, 0.020, 0.014, 0.24);
  playNoiseLayer("bandpass", 980, 1.3, 0.010, 0.012, 0.18);
}

function playFireSizzleSound() {
  playNoiseLayer("highpass", 1700, 0.9, 0.007, 0.004, 0.11);
  playNoiseLayer("bandpass", 2400, 1.4, 0.0035, 0.003, 0.08);
}

function playIcePlaceSound() {
  // Crisp crinkle — audible mid-high range
  playNoiseLayer("bandpass", 1800, 1.6, 0.030, 0.004, 0.10);
  playNoiseLayer("highpass", 2600, 1.0, 0.018, 0.003, 0.08);
}

function playLavaPlaceSound() {
  // Heavy bubbling: strong low-mid growl + subtle crackle
  playNoiseLayer("bandpass", 340, 1.15, 0.030, 0.015, 0.24);
  playNoiseLayer("bandpass", 980, 0.7, 0.010, 0.010, 0.16);
}

function playSmokePlaceSound() {
  // Airy whoosh
  playNoiseLayer("bandpass", 700, 0.6, 0.028, 0.010, 0.15);
  playNoiseLayer("highpass", 1100, 0.7, 0.014, 0.008, 0.12);
}

function playSandPlaceSound() {
  // Granular hiss
  playNoiseLayer("bandpass", 850, 1.1, 0.035, 0.006, 0.09);
  playNoiseLayer("highpass", 1400, 0.8, 0.016, 0.005, 0.07);
}

function playStonePlaceSound() {
  // Dense thud
  playNoiseLayer("bandpass", 480, 1.8, 0.032, 0.008, 0.11);
  playNoiseLayer("lowpass", 300, 1.4, 0.018, 0.010, 0.13);
}

function playBallBounceSound() {
  // Bouncy rubber ball
  playNoiseLayer("bandpass", 950, 1.2, 0.025, 0.004, 0.08);
  playNoiseLayer("highpass", 1600, 0.9, 0.014, 0.003, 0.06);
}

function playBrushAudio(material) {
  if (!audioCtx || audioCtx.state !== "running") return;

  switch (material) {
    case Material.WATER:  playWaterPourSound();  break;
    case Material.OIL:    playOilPourSound();    break;
    case Material.FIRE:   playFireSizzleSound(); break;
    case Material.ICE:    playIcePlaceSound();   break;
    case Material.LAVA:   playLavaPlaceSound();  break;
    case Material.SMOKE:  playSmokePlaceSound(); break;
    case Material.SAND:   playSandPlaceSound();  break;
    case Material.STONE:  playStonePlaceSound(); break;
    case Material.BALL:   playBallBounceSound(); break;
    default: break;
  }
}

function speakMaterialName(name) {
  if (isMuted) {
    return;
  }

  if (!("speechSynthesis" in window)) {
    return;
  }

  const now = performance.now();
  if (name === lastSpokenMaterial && now - lastSpokenAt < 350) {
    return;
  }
  lastSpokenMaterial = name;
  lastSpokenAt = now;

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(name);
  utterance.rate = 0.92;
  utterance.pitch = 1.0;
  utterance.volume = 0.9;
  window.speechSynthesis.speak(utterance);
}

resize();
window.addEventListener("resize", resize);
animationLoop();
