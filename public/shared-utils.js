// Secret Santa - Shared Utility Functions
// Handles encryption, decryption, and UI helpers

// Initialize crypto libraries check
if (typeof forge === 'undefined' || typeof CryptoJS === 'undefined') {
    document.body.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; background: linear-gradient(135deg, #0f4c75 0%, #1e3a5f 50%, #0f4c75 100%);">
            <div style="background: white; padding: 2rem; border-radius: 12px; border: 3px solid #c41e3a; max-width: 500px; text-align: center; box-shadow: 0 20px 40px rgba(0,0,0,0.3);">
                <h1 style="color: #c41e3a; font-size: 2rem; margin-bottom: 1rem;">❌ Loading Error</h1>
                <p style="color: #666; margin-bottom: 1rem;">Failed to load encryption libraries. This is required for secure operation.</p>
                <button onclick="location.reload()" style="background: linear-gradient(135deg, #c41e3a 0%, #8b0000 100%); color: white; padding: 12px 24px; border: none; border-radius: 8px; font-weight: bold; cursor: pointer;">
                    🔄 Refresh Page
                </button>
            </div>
        </div>
    `;
    throw new Error('Crypto libraries not loaded');
}

// ===== ENCRYPTION UTILITIES =====

// Derive deterministic RSA keypair from user credentials
function deriveKeyPairFromPassword(username, password, roomId, keySalt) {
    const seed = username + password + roomId;
    
    // PBKDF2: 100k iterations for strong key derivation (~10-15 sec)
    const keyMaterial = CryptoJS.PBKDF2(seed, keySalt, {
        keySize: 512/32,
        iterations: 100000
    }).toString();
    
    const seedBytes = forge.util.hexToBytes(keyMaterial);
    const prng = forge.random.createInstance();
    prng.seedFileSync = () => seedBytes;
    
    // Generate RSA-2048 keypair (deterministic from seed)
    return forge.pki.rsa.generateKeyPair({
        bits: 2048,
        prng: prng,
        workers: 0
    });
}

// Export public key to PEM format
function exportPublicKey(publicKey) {
    return forge.pki.publicKeyToPem(publicKey);
}

// Decrypt assignment with private key
function decryptWithPrivateKey(encryptedBase64, privateKey) {
    try {
        const encrypted = forge.util.decode64(encryptedBase64);
        return privateKey.decrypt(encrypted, 'RSA-OAEP', {
            md: forge.md.sha256.create(),
            mgf1: { md: forge.md.sha256.create() }
        });
    } catch (error) {
        console.error('Decryption error:', error);
        return null;
    }
}

// ===== UI UTILITIES =====

// Create festive snowfall animation
function createSnowflakes() {
    const snow = document.getElementById('snow');
    if (!snow) return;
    
    const symbols = ['❄', '❅', '❆'];
    
    for (let i = 0; i < 50; i++) {
        const flake = document.createElement('div');
        flake.className = 'snowflake';
        flake.textContent = symbols[Math.floor(Math.random() * symbols.length)];
        flake.style.left = Math.random() * 100 + '%';
        flake.style.animationDuration = (Math.random() * 3 + 2) + 's';
        flake.style.opacity = Math.random();
        flake.style.fontSize = (Math.random() * 10 + 10) + 'px';
        flake.style.animationDelay = (Math.random() * 2) + 's';
        snow.appendChild(flake);
    }
}

// Update button text and state
function setButtonState(button, text, disabled = false) {
    button.textContent = text;
    button.disabled = disabled;
}

// Simple async delay for UI updates
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ===== REGISTRATION FLOW =====

// Complete two-step registration with key generation
async function registerUser(roomId, username, password, submitButton) {
    try {
        setButtonState(submitButton, '📡 Requesting encryption parameters...', true);
        
        // Step 1: Get keySalt from server
        const initResponse = await fetch(`/api/rooms/${roomId}/init-register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        const initData = await initResponse.json();
        if (!initResponse.ok) throw new Error(initData.error);
        
        setButtonState(submitButton, '🔐 Generating encryption keys...', true);
        await delay(100);
        
        setButtonState(submitButton, '⚙️ Deriving keys (10-15 seconds)...', true);
        
        // Step 2: Generate keypair (computationally intensive)
        const keypair = deriveKeyPairFromPassword(username, password, roomId, initData.keySalt);
        const publicKeyPem = exportPublicKey(keypair.publicKey);
        
        setButtonState(submitButton, '📡 Completing registration...', true);
        
        // Step 3: Complete registration
        const response = await fetch(`/api/rooms/${roomId}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, publicKey: publicKeyPem, keySalt: initData.keySalt })
        });
        
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        
        setButtonState(submitButton, '✅ Registration complete!', true);
        await delay(500);
        
        return data;
    } finally {
        setButtonState(submitButton, '✨ Register & Join', false);
    }
}

// ===== LOGIN FLOW =====

// Login and decrypt assignment
async function loginAndDecrypt(roomId, username, password, submitButton) {
    try {
        setButtonState(submitButton, '🔓 Authenticating...', true);
        
        const response = await fetch(`/api/rooms/${roomId}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        
        setButtonState(submitButton, '🔐 Deriving decryption key...', true);
        await delay(100);
        
        // Re-derive private key from password
        const keypair = deriveKeyPairFromPassword(username, password, roomId, data.keySalt);
        
        setButtonState(submitButton, '🎁 Decrypting assignment (10-15 seconds)...', true);
        
        // Decrypt assignment
        const assignment = decryptWithPrivateKey(data.encryptedAssignment, keypair.privateKey);
        
        if (!assignment) {
            throw new Error('Failed to decrypt. Check your password.');
        }
        
        setButtonState(submitButton, '✅ Success!', true);
        await delay(500);
        
        return { username, assignment };
    } finally {
        setButtonState(submitButton, '🎁 View My Assignment', false);
    }
}

// Initialize snowflakes on page load
document.addEventListener('DOMContentLoaded', createSnowflakes);
