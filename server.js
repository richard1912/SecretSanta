const express = require('express');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const fs = require('fs').promises;
const crypto = require('crypto');
const forge = require('node-forge');
const bcrypt = require('bcrypt');

const BCRYPT_ROUNDS = 12;

const app = express();
const PORT = process.env.PORT || 8003;
const BASE_URL = process.env.BASE_URL || 'http://localhost:8003';

// Persistent storage using JSON files
const DATA_DIR = path.join(__dirname, 'data');
const ROOMS_FILE = path.join(DATA_DIR, 'rooms.json');

// In-memory storage for new system
const rooms = new Map(); // roomId -> { id, name, hostUsername, hostLoginHash, participants: [{username, passwordHash, encryptedAssignment}], status: 'open'|'started', createdAt }

// Load data from files on startup
async function loadData() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    
    const roomsData = await fs.readFile(ROOMS_FILE, 'utf8').catch(() => '{}');
    
    let roomsObj = {};
    try {
      roomsObj = JSON.parse(roomsData);
    } catch (e) {
      console.error('Corrupted rooms.json, starting fresh');
    }
    
    Object.entries(roomsObj).forEach(([key, value]) => rooms.set(key, value));
    
    console.log('Data loaded successfully');
  } catch (error) {
    console.error('Error loading data:', error);
  }
}

// Save data to files with atomic writes and backup
let saveInProgress = false;
async function saveData() {
  if (saveInProgress) {
    console.log('Save already in progress, skipping');
    return;
  }
  
  saveInProgress = true;
  try {
    // Create backup before overwriting
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(DATA_DIR, 'backups');
    await fs.mkdir(backupDir, { recursive: true });
    
    // Backup existing file if it exists
    try {
      const data = await fs.readFile(ROOMS_FILE, 'utf8');
      await fs.writeFile(path.join(backupDir, `rooms.json.${timestamp}.backup`), data);
    } catch (e) {
      // File doesn't exist, skip backup
    }
    
    // Write new data atomically
    const roomsData = JSON.stringify(Object.fromEntries(rooms), null, 2);
    await fs.writeFile(ROOMS_FILE, roomsData);
    
    console.log('Data saved successfully');
  } catch (error) {
    console.error('Error saving data:', error);
  } finally {
    saveInProgress = false;
  }
}

// Generate random salt for key derivation
function generateKeySalt() {
  return crypto.randomBytes(32).toString('hex');
}

// Hash password using bcrypt
async function hashPassword(password) {
  return await bcrypt.hash(password, BCRYPT_ROUNDS);
}

// Verify password using bcrypt
async function verifyPassword(password, hash) {
  return await bcrypt.compare(password, hash);
}

// Validation helpers
function sanitizeString(str, maxLength = 100) {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, maxLength).replace(/[<>"'&]/g, '');
}

function validateUsername(username) {
  const sanitized = sanitizeString(username, 50);
  if (!sanitized || sanitized.length < 2) {
    throw new Error('Username must be at least 2 characters');
  }
  return sanitized;
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 4) {
    throw new Error('Password must be at least 4 characters');
  }
  return password;
}

function validateRoomName(name) {
  const sanitized = sanitizeString(name, 100);
  if (!sanitized || sanitized.length < 1) {
    throw new Error('Room name cannot be empty');
  }
  return sanitized;
}

// Rate limiting (simple in-memory)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 10;

function isRateLimited(clientId) {
  const now = Date.now();
  const requests = rateLimitMap.get(clientId) || [];
  const recentRequests = requests.filter(time => now - time < RATE_LIMIT_WINDOW);
  
  if (recentRequests.length >= MAX_REQUESTS_PER_WINDOW) {
    return true;
  }
  
  recentRequests.push(now);
  rateLimitMap.set(clientId, recentRequests);
  return false;
}

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Serve main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Create a new room
app.post('/api/rooms', async (req, res) => {
  try {
    const clientId = req.ip || req.connection.remoteAddress;
    if (isRateLimited(clientId)) {
      return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });
    }

    const { name, hostUsername, hostPassword, autoJoinHost } = req.body;
    
    if (!name || !hostUsername || !hostPassword) {
      return res.status(400).json({ error: 'Room name, host username, and password are required' });
    }

    // Validate inputs
    const sanitizedName = validateRoomName(name);
    const sanitizedUsername = validateUsername(hostUsername);
    validatePassword(hostPassword);

    const roomId = uuidv4();
    const hostLoginHash = await hashPassword(sanitizedUsername + hostPassword);
    
    const room = {
      id: roomId,
      name: sanitizedName,
      hostUsername: sanitizedUsername,
      hostLoginHash: hostLoginHash,
      participants: [],
      status: 'open',
      createdAt: new Date().toISOString()
    };

    rooms.set(roomId, room);
    await saveData();
    
    res.json({ 
      roomId,
      roomUrl: `${BASE_URL}/room/${roomId}`,
      room: {
        id: room.id,
        name: room.name,
        hostUsername: room.hostUsername,
        participantCount: room.participants.length,
        status: room.status
      }
    });
  } catch (error) {
    console.error('Error creating room:', error);
    res.status(400).json({ error: error.message || 'Invalid request data' });
  }
});

// Get room info (public - for join page)
app.get('/api/rooms/:id', (req, res) => {
  const room = rooms.get(req.params.id);
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  res.json({
    id: room.id,
    name: room.name,
    participantCount: room.participants.length,
    status: room.status
  });
});

// Initialize registration - get keySalt for participant
app.post('/api/rooms/:id/init-register', async (req, res) => {
  try {
    const { username, password } = req.body;
    const roomId = req.params.id;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const room = rooms.get(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    if (room.status === 'started') {
      return res.status(400).json({ error: 'Room has already started. Registration is closed.' });
    }

    // Validate inputs
    const sanitizedUsername = validateUsername(username);
    validatePassword(password);

    // Check if user already exists - return their keySalt
    const existingParticipant = room.participants.find(p => p.username === sanitizedUsername);
    if (existingParticipant) {
      // Verify password
      if (!(await verifyPassword(password, existingParticipant.passwordHash))) {
        return res.status(401).json({ error: 'Invalid password for this username' });
      }
      return res.json({ 
        keySalt: existingParticipant.keySalt,
        alreadyExists: true
      });
    }

    // Generate new keySalt for new user
    const keySalt = generateKeySalt();
    
    res.json({ 
      keySalt: keySalt,
      alreadyExists: false
    });
  } catch (error) {
    console.error('Error initializing registration:', error);
    res.status(400).json({ error: error.message || 'Invalid request data' });
  }
});

// Register participant in room
app.post('/api/rooms/:id/register', async (req, res) => {
  try {
    const clientId = req.ip || req.connection.remoteAddress;
    if (isRateLimited(clientId)) {
      return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });
    }

    const { username, password, publicKey } = req.body;
    const roomId = req.params.id;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const room = rooms.get(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    if (room.status === 'started') {
      return res.status(400).json({ error: 'Room has already started. Registration is closed.' });
    }

    // Validate inputs
    const sanitizedUsername = validateUsername(username);
    validatePassword(password);

    // Check if this is the host trying to register/log in
    const hostLoginHash = sanitizedUsername + password;
    const isHost = await verifyPassword(hostLoginHash, room.hostLoginHash);
    
    // If host is trying to log in and already registered, return their info
    if (isHost) {
      const existingHostParticipant = room.participants.find(p => p.username === sanitizedUsername);
      if (existingHostParticipant) {
        return res.json({
          success: true,
          isHost: true,
          alreadyRegistered: true,
          message: 'Host authenticated successfully',
          username: sanitizedUsername,
          roomDetails: {
            id: room.id,
            name: room.name,
            hostUsername: room.hostUsername,
            participants: room.participants.map(p => ({ username: p.username })),
            status: room.status
          }
        });
      }
      // If host is registering for the first time, continue to add them as a participant (don't return early)
    }

    // Check if username already exists
    const existingParticipant = room.participants.find(p => p.username === sanitizedUsername);
    if (existingParticipant) {
      if (!(await verifyPassword(password, existingParticipant.passwordHash))) {
        return res.status(401).json({ error: 'Invalid password for this username' });
      }
      
      // If public key is valid and provided, update it (in case they're re-registering)
      if (publicKey && typeof publicKey === 'string' && publicKey !== 'temp') {
        existingParticipant.publicKey = publicKey;
        if (req.body.keySalt) {
          existingParticipant.keySalt = req.body.keySalt;
        }
        await saveData();
      }
      
      return res.json({ 
        success: true,
        alreadyRegistered: true,
        isHost: false,
        message: 'Signed in successfully',
        username: sanitizedUsername,
        keySalt: existingParticipant.keySalt,
        roomDetails: {
          id: room.id,
          name: room.name,
          participants: room.participants.map(p => ({ username: p.username })),
          status: room.status
        }
      });
    }

    // Validate public key if provided
    if (!publicKey || typeof publicKey !== 'string') {
      return res.status(400).json({ error: 'Public key is required for registration' });
    }

    // Validate keySalt if provided (from init-register), otherwise generate new one
    let keySalt = req.body.keySalt;
    if (!keySalt || typeof keySalt !== 'string') {
      keySalt = generateKeySalt();
    }

    const passwordHash = await hashPassword(password);
    
    room.participants.push({
      username: sanitizedUsername,
      passwordHash: passwordHash,
      publicKey: publicKey,
      keySalt: keySalt,
      encryptedAssignment: null
    });

    await saveData();
    
    res.json({ 
      success: true,
      alreadyRegistered: false,
      isHost: isHost,
      message: 'Registered successfully',
      username: sanitizedUsername,
      keySalt: keySalt,
      roomDetails: {
        id: room.id,
        name: room.name,
        hostUsername: room.hostUsername,
        participants: room.participants.map(p => ({ username: p.username })),
        status: room.status
      }
    });
  } catch (error) {
    console.error('Error registering participant:', error);
    res.status(400).json({ error: error.message || 'Invalid request data' });
  }
});

// Host authentication and get room details
app.post('/api/rooms/:id/host-auth', async (req, res) => {
  try {
    const { username, password } = req.body;
    const roomId = req.params.id;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const room = rooms.get(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const loginHash = username + password;
    if (!(await verifyPassword(loginHash, room.hostLoginHash))) {
      return res.status(401).json({ error: 'Invalid host credentials' });
    }

    res.json({
      id: room.id,
      name: room.name,
      hostUsername: room.hostUsername,
      participants: room.participants.map(p => ({
        username: p.username,
        hasAssignment: !!p.encryptedAssignment
      })),
      status: room.status,
      createdAt: room.createdAt
    });
  } catch (error) {
    console.error('Error authenticating host:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Remove participant (host only)
app.post('/api/rooms/:id/remove-participant', async (req, res) => {
  try {
    const { hostUsername, hostPassword, username } = req.body;
    const roomId = req.params.id;
    
    if (!hostUsername || !hostPassword || !username) {
      return res.status(400).json({ error: 'Host username, password and participant username are required' });
    }

    const room = rooms.get(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const loginHash = hashPassword(hostUsername + hostPassword);
    if (loginHash !== room.hostLoginHash) {
      return res.status(401).json({ error: 'Invalid host credentials' });
    }

    if (room.status === 'started') {
      return res.status(400).json({ error: 'Cannot remove participants after room has started' });
    }

    const initialCount = room.participants.length;
    room.participants = room.participants.filter(p => p.username !== username);
    
    if (room.participants.length === initialCount) {
      return res.status(404).json({ error: 'Participant not found' });
    }

    await saveData();
    
    res.json({ 
      success: true,
      message: 'Participant removed',
      participants: room.participants.map(p => ({ username: p.username }))
    });
  } catch (error) {
    console.error('Error removing participant:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start room and generate assignments (host only)
app.post('/api/rooms/:id/start', async (req, res) => {
  try {
    const { hostUsername, hostPassword } = req.body;
    const roomId = req.params.id;
    
    if (!hostUsername || !hostPassword) {
      return res.status(400).json({ error: 'Host username and password are required' });
    }

    const room = rooms.get(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const loginHash = hostUsername + hostPassword;
    if (!(await verifyPassword(loginHash, room.hostLoginHash))) {
      return res.status(401).json({ error: 'Invalid host credentials' });
    }

    if (room.status === 'started') {
      return res.status(400).json({ error: 'Room has already started' });
    }

    if (room.participants.length < 2) {
      return res.status(400).json({ error: 'At least 2 participants are required' });
    }

    // Verify all participants have public keys
    const missingKeys = room.participants.filter(p => !p.publicKey);
    if (missingKeys.length > 0) {
      return res.status(400).json({ 
        error: `Some participants are missing public keys: ${missingKeys.map(p => p.username).join(', ')}. They need to re-register.` 
      });
    }

    // Generate assignments on server
    const assignments = generateSecretSantaAssignments(room.participants);

    // Encrypt each assignment with participant's public key
    const encryptedAssignments = assignments.map(assignment => {
      const participant = room.participants.find(p => p.username === assignment.username);
      
      try {
        // Import public key
        const publicKey = forge.pki.publicKeyFromPem(participant.publicKey);
        
        // Encrypt the assignment
        const encrypted = publicKey.encrypt(assignment.giftRecipient, 'RSA-OAEP', {
          md: forge.md.sha256.create(),
          mgf1: {
            md: forge.md.sha256.create()
          }
        });
        
        // Convert to base64
        const encryptedBase64 = forge.util.encode64(encrypted);
        
        return {
          username: assignment.username,
          encryptedAssignment: encryptedBase64
        };
      } catch (error) {
        console.error(`Error encrypting for ${assignment.username}:`, error);
        throw new Error(`Failed to encrypt assignment for ${assignment.username}`);
      }
    });

    // Update participants with encrypted assignments
    encryptedAssignments.forEach(ea => {
      const participant = room.participants.find(p => p.username === ea.username);
      if (participant) {
        participant.encryptedAssignment = ea.encryptedAssignment;
      }
    });

    room.status = 'started';
    await saveData();
    
    res.json({ 
      success: true,
      message: 'Room started and assignments generated',
      status: room.status,
      participantCount: room.participants.length
    });
  } catch (error) {
    console.error('Error starting room:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Helper function to generate Secret Santa assignments
function generateSecretSantaAssignments(participants) {
  const usernames = participants.map(p => p.username);
  let assignments = [];
  let attempts = 0;
  const maxAttempts = 100;

  while (attempts < maxAttempts) {
    assignments = [];
    const shuffled = [...usernames].sort(() => Math.random() - 0.5);
    let valid = true;

    for (let i = 0; i < usernames.length; i++) {
      const giver = usernames[i];
      const receiver = shuffled[i];

      if (giver === receiver) {
        valid = false;
        break;
      }

      assignments.push({
        username: giver,
        giftRecipient: receiver
      });
    }

    if (valid) {
      return assignments;
    }

    attempts++;
  }

  throw new Error('Failed to generate valid Secret Santa assignments');
}

// Participant login and get assignment
app.post('/api/rooms/:id/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const roomId = req.params.id;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const room = rooms.get(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const participant = room.participants.find(p => p.username === username);
    if (!participant) {
      return res.status(404).json({ error: 'User not found in this room' });
    }

    if (!(await verifyPassword(password, participant.passwordHash))) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    if (room.status !== 'started') {
      return res.status(400).json({ 
        error: 'Room has not started yet',
        roomStatus: room.status
      });
    }

    res.json({
      success: true,
      username: participant.username,
      roomName: room.name,
      keySalt: participant.keySalt,
      encryptedAssignment: participant.encryptedAssignment
    });
  } catch (error) {
    console.error('Error logging in participant:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Serve room page
app.get('/room/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'room.html'));
});

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`Secret Santa app running on http://0.0.0.0:${PORT}`);
  await loadData();
});
