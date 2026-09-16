import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

// --- BLOCK DEFINITIONS & TEXTURE PATHS ---
const BLOCKS = {
    AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, SAND: 4,
    OAK_WOOD: 5, WATER: 6, SNOW: 7, OAK_LEAVES: 8,
    SPRUCE_WOOD: 9, SPRUCE_LEAVES: 10, ACACIA_WOOD: 11, ACACIA_LEAVES: 12,
    CACTUS: 13
};

const TEXTURE_PATHS = {
    [BLOCKS.GRASS]: { top: 'textures/grass_top.png', side: 'textures/grass_side.png', bottom: 'textures/dirt.png' },
    [BLOCKS.DIRT]: 'textures/dirt.png',
    [BLOCKS.STONE]: 'textures/stone.png',
    [BLOCKS.SAND]: 'textures/sand.png',
    [BLOCKS.OAK_WOOD]: { top: 'textures/oak_log_top.png', side: 'textures/oak_log_side.png', bottom: 'textures/oak_log_top.png' },
    [BLOCKS.WATER]: 'textures/water.png',
    [BLOCKS.SNOW]: 'textures/snow.png',
    [BLOCKS.OAK_LEAVES]: 'textures/oak_leaves.png',
    [BLOCKS.SPRUCE_WOOD]: { top: 'textures/spruce_log_top.png', side: 'textures/spruce_log_side.png', bottom: 'textures/spruce_log_top.png' },
    [BLOCKS.SPRUCE_LEAVES]: 'textures/spruce_leaves.png',
    [BLOCKS.ACACIA_WOOD]: { top: 'textures/acacia_log_top.png', side: 'textures/acacia_log_side.png', bottom: 'textures/acacia_log_top.png' },
    [BLOCKS.ACACIA_LEAVES]: 'textures/acacia_leaves.png',
    [BLOCKS.CACTUS]: { top: 'textures/cactus_top.png', side: 'textures/cactus_side.png', bottom: 'textures/cactus_bottom.png' }
};

// --- WEB WORKER GENERATOR ---
const workerCode = `
    function splitmix32(a) { 
        return function() { 
            a |= 0; a = a + 0x9e3779b9 | 0; 
            var t = a ^ a >>> 16; t = Math.imul(t, 0x21f0aaad); 
            t = t ^ t >>> 15; t = Math.imul(t, 0x735a2d97); 
            return ((t = t ^ t >>> 15) >>> 0) / 4294967296; 
        } 
    }
    
    function Noise2D(seed) {
        const rng = splitmix32(seed);
        const permutation = [];
        for(let i=0; i<256; i++) permutation.push(i);
        for(let i=255; i>0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [permutation[i], permutation[j]] = [permutation[j], permutation[i]];
        }
        const p = new Uint8Array(512);
        for (let i = 0; i < 256; i++) p[i] = p[i + 256] = permutation[i];
        
        function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
        function lerp(t, a, b) { return a + t * (b - a); }
        function grad(hash, x, y) {
            const h = hash & 15;
            const u = h < 8 ? x : y;
            const v = h < 4 ? y : h == 12 || h == 14 ? x : 0;
            return ((h & 1) == 0 ? u : -u) + ((h & 2) == 0 ? v : -v);
        }
        
        return function(x, y) {
            let X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
            x -= Math.floor(x); y -= Math.floor(y);
            const u = fade(x), v = fade(y);
            const a = p[X] + Y, aa = p[a], ab = p[a + 1];
            const b = p[X + 1] + Y, ba = p[b], bb = p[b + 1];
            return lerp(v, lerp(u, grad(p[aa], x, y), grad(p[ba], x - 1, y)),
                           lerp(u, grad(p[ab], x, y - 1), grad(p[bb], x - 1, y - 1)));
        };
    }

    let noiseHeight, noiseTemp, noiseRiver, noiseMtn;
    const chunkSize = 16;
    const BLOCKS = { AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, SAND: 4, OAK_WOOD: 5, WATER: 6, SNOW: 7, OAK_LEAVES: 8, SPRUCE_WOOD: 9, SPRUCE_LEAVES: 10, ACACIA_WOOD: 11, ACACIA_LEAVES: 12, CACTUS: 13 };

    function fbm(noiseFunc, x, z, octaves = 4, persistence = 0.5, freq = 0.005) {
        let total = 0, frequency = freq, amplitude = 1, maxValue = 0;
        for (let i = 0; i < octaves; i++) {
            total += noiseFunc(x * frequency, z * frequency) * amplitude;
            maxValue += amplitude;
            amplitude *= persistence;
            frequency *= 2;
        }
        return total / maxValue;
    }

    self.onmessage = function(e) {
        if (e.data.type === 'init') {
            noiseHeight = Noise2D(e.data.seed);
            noiseTemp = Noise2D(e.data.seed + 100);
            noiseRiver = Noise2D(e.data.seed + 200);
            noiseMtn = Noise2D(e.data.seed + 300);
        } else if (e.data.type === 'generate') {
            const { cx, cz, customBlocks } = e.data;
            const blocks = new Map();
            
            for (let x = 0; x < chunkSize; x++) {
                for (let z = 0; z < chunkSize; z++) {
                    const worldX = cx * chunkSize + x;
                    const worldZ = cz * chunkSize + z;
                    
                    const continental = fbm(noiseHeight, worldX, worldZ, 3, 0.5, 0.003);
                    const mtn = Math.pow(Math.max(0, fbm(noiseMtn, worldX, worldZ, 4, 0.5, 0.008)), 2) * 55;
                    const riverVal = Math.abs(fbm(noiseRiver, worldX, worldZ, 2, 0.5, 0.004));
                    const isRiver = riverVal < 0.035 && continental > -0.1;

                    let h = Math.floor(continental * 25 + mtn + 6);
                    if (isRiver) h = Math.min(h, -2); 

                    const temp = noiseTemp(worldX * 0.005, worldZ * 0.005);
                    let surface = BLOCKS.GRASS;
                    let biome = 'PLAINS';

                    if (temp > 0.25) { surface = BLOCKS.SAND; biome = 'DESERT'; }
                    else if (temp < -0.25) { surface = BLOCKS.SNOW; biome = 'SNOW'; }
                    else if (mtn > 20) { biome = 'MOUNTAIN'; surface = BLOCKS.STONE; }
                    else if (temp < -0.05) { biome = 'TAIGA'; }
                    else if (temp > 0.1) { biome = 'SAVANNA'; surface = BLOCKS.GRASS; }

                    for (let y = -25; y <= Math.max(h, 0); y++) {
                        let type = BLOCKS.AIR;
                        if (y < h - 4) type = BLOCKS.STONE;
                        else if (y < h) type = (surface === BLOCKS.SAND) ? BLOCKS.SAND : BLOCKS.DIRT;
                        else if (y === h) type = surface;
                        else if (y <= 0 && y > h) type = BLOCKS.WATER;

                        if (type !== BLOCKS.AIR) blocks.set(\`\${x},\${y},\${z}\`, type);
                    }

                    if (h > 0 && !isRiver && x > 2 && x < 13 && z > 2 && z < 13) {
                        const rnd = Math.abs(noiseTemp(worldX * 0.8, worldZ * 0.8));
                        if (biome === 'DESERT' && rnd > 0.46) {
                            for(let ch = 1; ch <= 3; ch++) blocks.set(\`\${x},\${h + ch},\${z}\`, BLOCKS.CACTUS);
                        } else if (biome === 'PLAINS' && surface === BLOCKS.GRASS && rnd > 0.44) {
                            buildTree(blocks, x, h, z, BLOCKS.OAK_WOOD, BLOCKS.OAK_LEAVES, 5);
                        } else if ((biome === 'SNOW' || biome === 'TAIGA') && rnd > 0.42) {
                            buildSpruceTree(blocks, x, h, z, biome === 'SNOW');
                        } else if (biome === 'SAVANNA' && rnd > 0.45) {
                            buildAcaciaTree(blocks, x, h, z);
                        }
                    }
                }
            }

            if (customBlocks) {
                for (const [key, type] of Object.entries(customBlocks)) {
                    if (type === 0) blocks.delete(key);
                    else blocks.set(key, type);
                }
            }

            const instancesByType = {};
            for (const [key, type] of blocks.entries()) {
                const [x, y, z] = key.split(',').map(Number);
                if (!instancesByType[type]) instancesByType[type] = [];
                instancesByType[type].push(x + cx * chunkSize, y, z + cz * chunkSize);
            }

            const rawBlocks = {};
            for(const [k, v] of blocks.entries()) rawBlocks[k] = v;

            self.postMessage({ cx, cz, instancesByType, blocksMap: rawBlocks });
        }
    };

    function buildTree(blocks, x, h, z, log, leaves, height) {
        for (let th = 1; th <= height; th++) blocks.set(\`\${x},\${h + th},\${z}\`, log);
        for (let lx = -2; lx <= 2; lx++) {
            for (let lz = -2; lz <= 2; lz++) {
                for (let ly = height - 1; ly <= height + 1; ly++) {
                    if (Math.abs(lx) === 2 && Math.abs(lz) === 2) continue;
                    const k = \`\${x + lx},\${h + ly},\${z + lz}\`;
                    if (!blocks.has(k)) blocks.set(k, leaves);
                }
            }
        }
    }

    function buildSpruceTree(blocks, x, h, z, snowCover) {
        const height = 7;
        for (let th = 1; th <= height; th++) blocks.set(\`\${x},\${h + th},\${z}\`, BLOCKS.SPRUCE_WOOD);
        for (let ly = 3; ly <= height + 1; ly++) {
            const rad = (height + 1 - ly) % 2 === 0 ? 2 : 1;
            for (let lx = -rad; lx <= rad; lx++) {
                for (let lz = -rad; lz <= rad; lz++) {
                    const k = \`\${x + lx},\${h + ly},\${z + lz}\`;
                    if (!blocks.has(k)) {
                        blocks.set(k, snowCover && ly === height + 1 ? BLOCKS.SNOW : BLOCKS.SPRUCE_LEAVES);
                    }
                }
            }
        }
    }

    function buildAcaciaTree(blocks, x, h, z) {
        for (let th = 1; th <= 4; th++) blocks.set(\`\${x},\${h + th},\${z}\`, BLOCKS.ACACIA_WOOD);
        for (let lx = -3; lx <= 3; lx++) {
            for (let lz = -3; lz <= 3; lz++) {
                if (Math.abs(lx) + Math.abs(lz) > 4) continue;
                const k = \`\${x + lx},\${h + 5},\${z + lz}\`;
                if (!blocks.has(k)) blocks.set(k, BLOCKS.ACACIA_LEAVES);
            }
        }
    }
`;

// --- GAME ENGINE SETUP ---
let scene, camera, renderer, controls;
let sunLight, hemiLight;

const CHUNK_SIZE = 16;
const RENDER_DISTANCE = 4;
const chunks = new Map();
const worldBlocks = new Map();
const modifiedBlocks = new Map();
const blockMaterials = {};

let playerSpawned = false;
const playerVelocity = new THREE.Vector3();
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false, isSwimming = false, isSubmerged = false;

let prevTime = performance.now();
let frames = 0, lastFpsTime = 0;

const voxelGeo = new THREE.BoxGeometry(1, 1, 1);
const textureLoader = new THREE.TextureLoader();

// Hotbar System
const inventory = [ BLOCKS.OAK_WOOD, BLOCKS.STONE, BLOCKS.SAND, BLOCKS.DIRT ];
let selectedSlot = 0;

function updateHotbarUI() {
    const slots = document.querySelectorAll('.slot');
    slots.forEach((slot, idx) => {
        if (idx === selectedSlot) slot.classList.add('active');
        else slot.classList.remove('active');
    });
}

function loadTexture(url) {
    const tex = textureLoader.load(url);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
}

function createMaterial(type, texturePath) {
    const isWater = (type == BLOCKS.WATER);
    const isLeaves = (type == BLOCKS.OAK_LEAVES || type == BLOCKS.SPRUCE_LEAVES || type == BLOCKS.ACACIA_LEAVES);
    return new THREE.MeshStandardMaterial({
        map: loadTexture(texturePath),
        transparent: isWater || isLeaves,
        opacity: isWater ? 0.75 : 1.0,
        roughness: 0.8,
        side: isLeaves || isWater ? THREE.DoubleSide : THREE.FrontSide,
        depthWrite: !isWater
    });
}

// Generate Materials Array
Object.entries(TEXTURE_PATHS).forEach(([type, paths]) => {
    if (typeof paths === 'string') {
        blockMaterials[type] = createMaterial(type, paths);
    } else {
        blockMaterials[type] = [
            createMaterial(type, paths.side),   
            createMaterial(type, paths.side),   
            createMaterial(type, paths.top),    
            createMaterial(type, paths.bottom), 
            createMaterial(type, paths.side),   
            createMaterial(type, paths.side)    
        ];
    }
});

const blob = new Blob([workerCode], { type: 'application/javascript' });
const worker = new Worker(URL.createObjectURL(blob));
worker.postMessage({ type: 'init', seed: 1337 });

init();
animate();

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB);
    scene.fog = new THREE.FogExp2(0x87CEEB, 0.012);

    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 40, 0);

    hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
    scene.add(hemiLight);

    sunLight = new THREE.DirectionalLight(0xffffff, 0.9);
    sunLight.position.set(100, 150, 50);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    scene.add(sunLight);

    renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(renderer.domElement);

    controls = new PointerLockControls(camera, document.body);
    const blocker = document.getElementById('blocker');

    blocker.addEventListener('click', () => { if (playerSpawned) controls.lock(); });
    controls.addEventListener('lock', () => blocker.style.display = 'none');
    controls.addEventListener('unlock', () => blocker.style.display = 'flex');

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('resize', onWindowResize);

    worker.onmessage = (e) => {
        const { cx, cz, instancesByType, blocksMap } = e.data;
        const chunkKey = `${cx},${cz}`;

        if (chunks.has(chunkKey) && chunks.get(chunkKey)) {
            chunks.get(chunkKey).forEach(m => { scene.remove(m); m.geometry.dispose(); });
        }

        const chunkMeshes = [];
        for (const [type, positions] of Object.entries(instancesByType)) {
            const count = positions.length / 3;
            if (count === 0) continue;

            const instancedMesh = new THREE.InstancedMesh(voxelGeo, blockMaterials[type], count);
            instancedMesh.castShadow = true;
            instancedMesh.receiveShadow = true;

            const dummy = new THREE.Object3D();
            for (let i = 0; i < count; i++) {
                dummy.position.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
                dummy.updateMatrix();
                instancedMesh.setMatrixAt(i, dummy.matrix);
            }
            instancedMesh.instanceMatrix.needsUpdate = true;
            scene.add(instancedMesh);
            chunkMeshes.push(instancedMesh);
        }

        chunks.set(chunkKey, chunkMeshes);

        for (const [key, type] of Object.entries(blocksMap)) {
            const [lx, y, lz] = key.split(',').map(Number);
            worldBlocks.set(`${lx + cx * CHUNK_SIZE},${y},${lz + cz * CHUNK_SIZE}`, type);
        }

        if (!playerSpawned && cx === 0 && cz === 0) {
            for (let y = 60; y > -20; y--) {
                if (worldBlocks.has(`0,${y},0`) && worldBlocks.get(`0,${y},0`) !== BLOCKS.WATER) {
                    camera.position.set(0, y + 2.8, 0);
                    playerSpawned = true;
                    document.getElementById('titleText').innerText = "Voxel World";
                    document.getElementById('subText').innerText = "Click to Play | WASD: Move | Space: Jump | 1-4: Select Block";
                    break;
                }
            }
        }
    };

    requestInitialChunks();
}

function requestInitialChunks() {
    for (let x = -RENDER_DISTANCE; x <= RENDER_DISTANCE; x++) {
        for (let z = -RENDER_DISTANCE; z <= RENDER_DISTANCE; z++) {
            const key = `${x},${z}`;
            if (!chunks.has(key)) {
                chunks.set(key, null);
                worker.postMessage({ type: 'generate', cx: x, cz: z });
            }
        }
    }
}

let canJump = false;

function onKeyDown(e) {
    switch (e.code) {
        case 'KeyW': moveForward = true; break;
        case 'KeyA': moveLeft = true; break;
        case 'KeyS': moveBackward = true; break;
        case 'KeyD': moveRight = true; break;
        case 'Digit1': selectedSlot = 0; updateHotbarUI(); break;
        case 'Digit2': selectedSlot = 1; updateHotbarUI(); break;
        case 'Digit3': selectedSlot = 2; updateHotbarUI(); break;
        case 'Digit4': selectedSlot = 3; updateHotbarUI(); break;
        case 'Space': 
            if (isSwimming) playerVelocity.y = 4.0;
            else if (canJump) { playerVelocity.y = 8.5; canJump = false; }
            break;
    }
}

function onKeyUp(e) {
    switch (e.code) {
        case 'KeyW': moveForward = false; break;
        case 'KeyA': moveLeft = false; break;
        case 'KeyS': moveBackward = false; break;
        case 'KeyD': moveRight = false; break;
    }
}

function onMouseDown(e) {
    if (!controls.isLocked) return;
    
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);

    let current = raycaster.ray.origin.clone();
    let step = raycaster.ray.direction.clone().normalize().multiplyScalar(0.05);
    let prevBlockPos = null;

    for (let i = 0; i < 120; i++) {
        current.add(step);
        const bx = Math.round(current.x);
        const by = Math.round(current.y);
        const bz = Math.round(current.z);

        const block = worldBlocks.get(`${bx},${by},${bz}`);
        
        // Ignore air and water for mining/collision
        if (block && block !== BLOCKS.AIR && block !== BLOCKS.WATER) {
            if (e.button === 0) { 
                worldBlocks.delete(`${bx},${by},${bz}`);
                saveCustomBlock(bx, by, bz, 0);
                refreshChunk(bx, bz);
            } else if (e.button === 2) { 
                if (prevBlockPos) {
                    const { px, py, pz } = prevBlockPos;
                    const activeBlock = inventory[selectedSlot];
                    worldBlocks.set(`${px},${py},${pz}`, activeBlock);
                    saveCustomBlock(px, py, pz, activeBlock);
                    refreshChunk(px, pz);
                }
            }
            break;
        }
        prevBlockPos = { px: bx, py: by, pz: bz };
    }
}

function saveCustomBlock(wx, wy, wz, type) {
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const chunkKey = `${cx},${cz}`;

    if (!modifiedBlocks.has(chunkKey)) modifiedBlocks.set(chunkKey, {});
    modifiedBlocks.get(chunkKey)[`${lx},${wy},${lz}`] = type;
}

function refreshChunk(wx, wz) {
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const key = `${cx},${cz}`;
    const custom = modifiedBlocks.get(key) || {};
    worker.postMessage({ type: 'generate', cx, cz, customBlocks: custom });
}

function checkCollision(pos) {
    const radius = 0.3; 
    const minX = Math.floor(pos.x - radius);
    const maxX = Math.floor(pos.x + radius);
    const minY = Math.floor(pos.y - 1.62); 
    const maxY = Math.floor(pos.y + 0.18);
    const minZ = Math.floor(pos.z - radius);
    const maxZ = Math.floor(pos.z + radius);

    for (let x = minX; x <= maxX; x++) {
        for (let y = minY; y <= maxY; y++) {
            for (let z = minZ; z <= maxZ; z++) {
                const block = worldBlocks.get(`${x},${y},${z}`);
                if (block && block !== BLOCKS.AIR && block !== BLOCKS.WATER) return true;
            }
        }
    }
    return false;
}

function applyPhysics(delta) {
    if (!playerSpawned) return;

    const eyePos = camera.position.clone();
    const feetBlockY = Math.floor(eyePos.y - 1.5);
    const headBlockY = Math.floor(eyePos.y);
    const blockAtFeet = worldBlocks.get(`${Math.round(eyePos.x)},${feetBlockY},${Math.round(eyePos.z)}`);
    const blockAtHead = worldBlocks.get(`${Math.round(eyePos.x)},${headBlockY},${Math.round(eyePos.z)}`);

    isSwimming = (blockAtFeet === BLOCKS.WATER);
    isSubmerged = (blockAtHead === BLOCKS.WATER);

    document.getElementById('water-overlay').style.display = isSubmerged ? 'block' : 'none';

    if (isSwimming) {
        playerVelocity.y -= 4.0 * delta; 
        playerVelocity.y = Math.max(playerVelocity.y, -3.0); 
    } else {
        playerVelocity.y -= 25.0 * delta;
        playerVelocity.y = Math.max(playerVelocity.y, -30.0);
    }

    const moveDir = new THREE.Vector3();
    moveDir.z = Number(moveForward) - Number(moveBackward);
    moveDir.x = Number(moveRight) - Number(moveLeft);
    moveDir.normalize();

    const speed = isSwimming ? 4.0 : 7.0;
    const damping = 10.0;

    if (moveForward || moveBackward) playerVelocity.z -= moveDir.z * speed * damping * delta;
    if (moveLeft || moveRight) playerVelocity.x -= moveDir.x * speed * damping * delta;

    playerVelocity.x -= playerVelocity.x * damping * delta;
    playerVelocity.z -= playerVelocity.z * damping * delta;

    const pos = camera.position.clone();
    pos.y += playerVelocity.y * delta;
    if (checkCollision(pos)) {
        if (playerVelocity.y < 0) {
            canJump = true;
            pos.y = Math.ceil(pos.y - 1.62) + 1.62;
        } else {
            pos.y = Math.floor(pos.y + 0.18) - 0.19;
        }
        playerVelocity.y = 0;
    } else {
        canJump = false;
    }

    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    right.y = 0; right.normalize();
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    forward.y = 0; forward.normalize();

    const moveStep = forward.clone().multiplyScalar(-playerVelocity.z * delta)
        .add(right.clone().multiplyScalar(playerVelocity.x * delta));

    pos.x += moveStep.x;
    if (checkCollision(pos)) pos.x -= moveStep.x;

    pos.z += moveStep.z;
    if (checkCollision(pos)) pos.z -= moveStep.z;

    camera.position.copy(pos);
}

function updateChunks() {
    if (!playerSpawned) return;
    const pcx = Math.floor(camera.position.x / CHUNK_SIZE);
    const pcz = Math.floor(camera.position.z / CHUNK_SIZE);

    for (let x = -RENDER_DISTANCE; x <= RENDER_DISTANCE; x++) {
        for (let z = -RENDER_DISTANCE; z <= RENDER_DISTANCE; z++) {
            const cx = pcx + x;
            const cz = pcz + z;
            const key = `${cx},${cz}`;
            if (!chunks.has(key)) {
                chunks.set(key, null);
                const custom = modifiedBlocks.get(key) || {};
                worker.postMessage({ type: 'generate', cx, cz, customBlocks: custom });
            }
        }
    }

    for (const [key, meshArray] of chunks.entries()) {
        const [cx, cz] = key.split(',').map(Number);
        if (Math.abs(cx - pcx) > RENDER_DISTANCE + 1 || Math.abs(cz - pcz) > RENDER_DISTANCE + 1) {
            if (meshArray) meshArray.forEach(m => { scene.remove(m); m.geometry.dispose(); });
            chunks.delete(key);
        }
    }
}

function animate() {
    requestAnimationFrame(animate);
    const time = performance.now();
    const delta = Math.min((time - prevTime) / 1000, 0.1);

    if (controls.isLocked) applyPhysics(delta);
    updateChunks();

    frames++;
    if (time - lastFpsTime >= 1000) {
        document.getElementById('ui').innerHTML = `FPS: ${frames}<br>Chunks Loaded: ${chunks.size}<br>Swimming: ${isSwimming}`;
        frames = 0;
        lastFpsTime = time;
    }

    renderer.render(scene, camera);
    prevTime = time;
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}