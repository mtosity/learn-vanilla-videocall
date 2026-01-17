# How It Works - Simple Video Call

This document explains step-by-step how the simple video call application works, from the moment a user enters their name to the establishment of peer-to-peer video connections.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Signaling Server (server.js)](#signaling-server-serverjs)
3. [Client Side (app.js)](#client-side-appjs)
4. [Connection Flow](#connection-flow)
5. [Code Structure](#code-structure)
6. [Technical Details](#technical-details)

## Architecture Overview

The application uses a client-server architecture with two main components:

- **Signaling Server**: Node.js server running Socket.IO to facilitate connection establishment
- **WebRTC Client**: Browser-based application that handles peer-to-peer video/audio communication

### Key Technologies

- **Socket.IO**: WebSocket library for real-time bidirectional communication between clients and server
- **WebRTC**: Browser API for peer-to-peer real-time communication
- **RTCPeerConnection**: Core WebRTC API for establishing peer connections
- **getUserMedia**: API for accessing camera and microphone

## Signaling Server (server.js)

### 1. Server Initialization

```javascript
const express = require('express')
const app = express()
const server = http.createServer(app)
const io = socketIo(server, { cors: { origin: '*' } })
```

The server:
- Creates an Express HTTP server
- Attaches Socket.IO for WebSocket connections
- Enables CORS to allow connections from any origin
- Serves static files from the `public` directory

### 2. Room Management System

```javascript
const rooms = new Map()
```

The server maintains a `Map` called `rooms` to track participants in each call room:
- **Key**: Room ID (hardcoded as 'default-room' in this app)
- **Value**: Set of participants (each participant has socket ID and name)

### 3. Socket Connection Events

#### When a client connects:
```javascript
io.on('connection', (socket) => {
    console.log('User connected:', socket.id)
    // Handle all subsequent events...
})
```

#### When a user joins a call:
```javascript
socket.on('join-call', (roomId, userName) => {
    socket.join(roomId)
    
    // Initialize room if it doesn't exist
    if (!rooms.has(roomId)) {
        rooms.set(roomId, new Set())
    }
    
    // Add user to room participants
    rooms.get(roomId).add({ id: socket.id, name: userName })
    
    // Get list of existing participants (excluding current user)
    const otherParticipants = Array.from(rooms.get(roomId))
        .filter(p => p.id !== socket.id)
        .map(p => p.id)
    
    // Send participant list to the joining user
    socket.emit('joined-call', otherParticipants)
    
    // Notify other users that someone joined
    socket.to(roomId).emit('user-joined', socket.id, userName)
})
```

**Steps**:
1. User is added to Socket.IO room
2. User is stored in the room's participant Set
3. A list of existing participants (their socket IDs) is sent to the new user
4. Other participants are notified about the new user

#### WebRTC Signaling Events:

**Offer (SDP)**: When creating a new peer connection
```javascript
socket.on('offer', (targetId, offer) => {
    io.to(targetId).emit('offer', socket.id, offer)
})
```
**Flow**: User A → Server → User B

**Answer (SDP)**: When responding to an offer
```javascript
socket.on('answer', (targetId, answer) => {
    io.to(targetId).emit('answer', socket.id, answer)
})
```
**Flow**: User B → Server → User A

**ICE Candidates**: For network traversal
```javascript
socket.on('ice-candidate', (targetId, candidate) => {
    io.to(targetId).emit('ice-candidate', socket.id, candidate)
})
```
**Flow**: Either peer → Server → Other peer

#### When a user disconnects:
```javascript
socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id)
    
    for (const [roomId, participants] of rooms) {
        // Find which room the user was in
        const participantToRemove = Array.from(participants).find(p => p.id === socket.id)
        if (participantToRemove) {
            participants.delete(participantToRemove)
            // Notify others in the room
            socket.to(roomId).emit('user-left', socket.id)
            
            // Remove empty room
            if (participants.size === 0) {
                rooms.delete(roomId)
            }
            break
        }
    }
})
```

**Steps**:
1. Find the room the disconnected user was in
2. Remove user from participants Set
3. Notify other users that someone left
4. Clean up empty rooms

## Client Side (app.js)

### 1. Initial Setup

```javascript
const socket = io()
const roomId = 'default-room'
```

- Connects to Socket.IO server
- Defines a hardcoded room ID (everyone joins the same room)
- Gets references to DOM elements
- Attaches event listeners to buttons

### 2. Joining a Call

```javascript
async function joinCall() {
    const userName = nameInput.value.trim()
    if (!userName) {
        alert('Please enter your name')
        return
    }

    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: true
        })
        localVideo.srcObject = localStream

        setupContainer.style.display = 'none'
        callContainer.style.display = 'block'

        socket.emit('join-call', roomId, userName)
    } catch (error) {
        console.error('Error accessing media devices:', error)
        alert('Could not access camera/microphone')
    }
}
```

**Steps**:
1. Validate user entered a name
2. Request camera and microphone access using `getUserMedia`
3. Display local video stream in `<video>` element
4. Switch UI to call mode
5. Emit 'join-call' event to server with room ID and name

### 3. Socket Event Handlers

#### When user successfully joins:
```javascript
socket.on('joined-call', async (otherParticipants) => {
    for (const participantId of otherParticipants) {
        createPeerConnection(participantId, true)
    }
})
```

**Purpose**: Received when you join. Creates peer connections with all existing participants (you are the initiator).

#### When another user joins:
```javascript
socket.on('user-joined', async (participantId) => {
    createPeerConnection(participantId, false)
})
```

**Purpose**: Received when someone new joins. Creates a peer connection with that user (you are the responder).

#### When a user leaves:
```javascript
socket.on('user-left', (participantId) => {
    const peer = peers.get(participantId)
    if (peer) {
        if (peer.connection) {
            peer.connection.close()
        }
        if (peer.videoElement) {
            peer.videoElement.remove()
        }
        peers.delete(participantId)
    }
})
```

**Purpose**: Clean up peer connection and remove video when someone disconnects.

#### When receiving an offer (SDP):
```javascript
socket.on('offer', async (fromId, offer) => {
    const peer = peers.get(fromId)
    if (peer) {
        await peer.connection.setRemoteDescription(offer)
        const answer = await peer.connection.createAnswer()
        await peer.connection.setLocalDescription(answer)
        socket.emit('answer', fromId, answer)
    }
})
```

**Flow**: 
1. Receive offer from peer (as responder)
2. Set remote description
3. Create answer
4. Set local description
5. Send answer back through signaling server

#### When receiving an answer (SDP):
```javascript
socket.on('answer', async (fromId, answer) => {
    const peer = peers.get(fromId)
    if (peer) {
        await peer.connection.setRemoteDescription(answer)
    }
})
```

**Flow**: 
1. Receive answer from peer (as initiator)
2. Set remote description
3. Connection is now established

#### When receiving ICE candidates:
```javascript
socket.on('ice-candidate', async (fromId, candidate) => {
    const peer = peers.get(fromId)
    if (peer && peer.connection) {
        try {
            await peer.connection.addIceCandidate(candidate)
        } catch (error) {
            console.error('Error adding ICE candidate:', error)
        }
    }
})
```

**Purpose**: ICE candidates are network addresses. These are exchanged to help peers connect through NATs and firewalls.

### 4. Creating Peer Connections

```javascript
async function createPeerConnection(peerId, isInitiator) {
    // Create WebRTC connection with STUN servers
    const peerConnection = new RTCPeerConnection({
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    })

    // Create video element for remote stream
    const videoElement = document.createElement('video')
    videoElement.autoplay = true
    videoElement.playsInline = true
    remoteVideosContainer.appendChild(videoElement)

    // Store connection and video element
    peers.set(peerId, { connection: peerConnection, videoElement })

    // Add local tracks to connection
    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream)
    })

    // Handle incoming remote tracks
    peerConnection.ontrack = (event) => {
        videoElement.srcObject = event.streams[0]
    }

    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', peerId, event.candidate)
        }
    }

    // Handle connection state changes
    peerConnection.oniceconnectionstatechange = () => {
        if (peerConnection.iceConnectionState === 'disconnected' || 
            peerConnection.iceConnectionState === 'failed') {
            videoElement.remove()
            peers.delete(peerId)
        }
    }

    // Start connection if initiator
    if (isInitiator) {
        const offer = await peerConnection.createOffer()
        await peerConnection.setLocalDescription(offer)
        socket.emit('offer', peerId, offer)
    }
}
```

**Peer Connection Details**:

1. **RTCPeerConnection Configuration**:
   - Uses Google's public STUN servers for NAT traversal
   - STUN (Session Traversal Utilities for NAT) helps find public IP addresses

2. **Adding Local Media**:
   - Each track (audio + video) from localStream is added to the peer connection
   - This tells WebRTC to send these tracks to the remote peer

3. **Receiving Remote Media**:
   - `ontrack` event fires when remote peer starts sending media
   - Remote stream is assigned to video element's `srcObject`

4. **ICE Candidate Exchange**:
   - `onicecandidate` fires when WebRTC discovers network addresses
   - Candidates are immediately sent to the remote peer via signaling server
   - This process continues throughout the call as needed

5. **Connection Monitoring**:
   - `oniceconnectionstatechange` monitors connection health
   - If disconnected or failed, clean up resources

6. **Initiator Role**:
   - If `isInitiator` is true, immediately create and send offer
   - This starts the WebRTC handshake process

## Connection Flow

### Complete Connection Sequence (2 participants)

#### User A joins first:
1. User A enters name and clicks "Join Call"
2. `getUserMedia` requests camera/microphone
3. Local video stream starts playing
4. Socket emits 'join-call' with roomId and name
5. Server creates room with User A as only participant
6. Server emits 'joined-call' to User A with empty participant list
7. No peer connections needed yet (alone in room)

#### User B joins (User A already there):
1. User B enters name and clicks "Join Call"
2. `getUserMedia` requests camera/microphone
3. Local video stream starts playing
4. Socket emits 'join-call' with roomId and name
5. Server adds User B to existing room
6. Server emits 'joined-call' to User B with [User A's socket ID]
7. Server emits 'user-joined' to User A's socket with User B's socket ID

#### Connection establishment between A and B:

**User B (the "joiner"):**
8. Receives 'joined-call' event with [User A's ID]
9. Calls `createPeerConnection(userA_Id, true)` - isInitiator = true
10. Creates RTCPeerConnection and adds local tracks
11. Creates offer: `createOffer()` → SDP object
12. Sets local description: `setLocalDescription(offer)`
13. Emits 'offer' event to server with User A's ID and the SDP

**Server relays offer:**
14. Receives 'offer' from User B
15. Emits 'offer' to User A's socket with User B's ID and the SDP

**User A (the "existing user"):**
16. Receives 'user-joined' event with User B's ID
17. Calls `createPeerConnection(userB_Id, false)` - isInitiator = false
18. Creates RTCPeerConnection and adds local tracks
19. (No offer creation - waiting for one)

20. Receives 'offer' event from server with User B's ID and SDP
21. Gets peer connection for User B
22. Sets remote description: `setRemoteDescription(offer)`
23. Creates answer: `createAnswer()` → SDP object
24. Sets local description: `setLocalDescription(answer)`
25. Emits 'answer' event to server with User B's ID and the SDP

**Server relays answer:**
26. Receives 'answer' from User A
27. Emits 'answer' to User B's socket with User A's ID and the SDP

**User B:**
28. Receives 'answer' event from server with User A's ID and SDP
29. Gets peer connection for User A
30. Sets remote description: `setRemoteDescription(answer)`

#### ICE Candidate Exchange (happens concurrently):

Both peers continuously:
1. Generate ICE candidates as they discover network paths
2. `onicecandidate` event fires
3. Send candidates to remote peer via signaling server
4. Remote peer receives and adds candidates with `addIceCandidate()`

#### Video/Audio Flow:

Once connection is established:
1. WebRTC negotiates codecs and formats
2. Encoded media packets flow directly between peers (P2P)
3. `ontrack` event fires when first remote packets arrive
4. Remote video element srcObject is set to the incoming stream
5. Media plays in real-time

### For 3+ Participants

The same pattern repeats for each new participant:
- Existing users create peer connections to new user (responder)
- New user creates peer connections to all existing users (initiator)
- Each pair performs independent WebRTC handshake
- Result: N(N-1)/2 active connections for N participants (full mesh)

## Code Structure

### server.js
```
server.js
├── Dependencies & Setup (Express, Socket.IO, HTTP server)
├── Static file serving
├── Room management (new Map())
└── Socket event handlers
    ├── 'connection' - main handler
    ├── 'join-call' - join room
    ├── 'offer' - forward offers
    ├── 'answer' - forward answers
    ├── 'ice-candidate' - forward candidates
    └── 'disconnect' - cleanup
```

### public/app.js
```
app.js
├── Global variables (socket, roomId, streams, peers map)
├── DOM element references
├── Event listeners (join button, leave button)
├── joinCall() function - start video, socketjoin
├── leaveCall() function - cleanup, disconnect
├── Socket event handlers
│   ├── 'joined-call' - handle own join
│   ├── 'user-joined' - handle others joining
│   ├── 'user-left' - handle disconnects
│   ├── 'offer' - as responder
│   ├── 'answer' - as initiator
│   └── 'ice-candidate' - add ICE candidates
└── createPeerConnection() - WebRTC logic
```

### public/index.html
```
Structure:
├── Setup container (name input, join button)
└── Call container (videos, leave button)
    ├── Local video element
    └── Remote videos container (dynamically populated)
```

### public/styles.css
```
CSS covers:
├── Global styles (reset, dark theme, fonts)
├── Setup screen layout
├── Call screen layout
├── Video positioning (local small, remote grid)
└── Responsive design (mobile adaptation)
```

## Technical Details

### WebRTC Session Description Protocol (SDP)

SDP is a text-based format that describes:
- Media capabilities (codecs, resolutions, bitrates)
- Network transport information
- Session metadata

**Offer SDP** (initiator → responder):
```javascript
{
    type: "offer",
    sdp: "v=0\r\no=- 12345 0 IN IP4 0.0.0.0\r\n..."
}
```

**Answer SDP** (responder → initiator):
```javascript
{
    type: "answer",
    sdp: "v=0\r\no=- 67890 0 IN IP4 0.0.0.0\r\n..."
}
```

### ICE (Interactive Connectivity Establishment)

ICE is a framework for NAT traversal:

1. **STUN Servers**: Help discover public IP address
   - Client asks: "What's my public IP?"
   - Server responds: "Your IP is X.X.X.X:YYYY"

2. **ICE Candidates**: Network addresses where peer can be reached
   ```javascript
   {
       candidate: "candidate:1 1 UDP 2130706431 192.168.1.10 54321 typ host",
       sdpMid: "0",
       sdpMLineIndex: 0
   }
   ```

3. **Candidate Types**:
   - `host`: Direct local address
   - `srflx`: Public address (via STUN)
   - `relay`: Relayed address (via TURN - not used in this simple app)

### WebRTC Connection States

- `new`: Connection created
- `connecting`: Gathering ICE candidates
- `connected`: Connection established
- `disconnected`: Connection lost, may recover
- `failed`: Connection failed, won't recover
- `closed`: Connection closed

### Media Streams and Tracks

**Local acquisition**:
```javascript
const localStream = await navigator.mediaDevices.getUserMedia({
    video: true,  // Request video
    audio: true   // Request audio
})
```

**Adding to peer connection**:
```javascript
localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream)
})
```

**Receiving remote media**:
```javascript
peerConnection.ontrack = (event) => {
    // event.streams[0] contains remote media
    videoElement.srcObject = event.streams[0]
}
```

### Error Handling

**Media access errors**:
- NotAllowedError: User denied camera/microphone permission
- NotFoundError: No camera/microphone found
- NotReadableError: Device in use by another application

**WebRTC errors**:
- ICE connection failures (network issues)
- SDP negotiation failures (codec mismatch)
- Track addition errors

### Security Considerations

1. **HTTPS Requirement**: getUserMedia() requires HTTPS in most browsers
2. **CORS**: Socket.IO server allows all origins (adjust for production)
3. **Permissions**: Browser asks user for camera/microphone access
4. **No Authentication**: Anyone can join the call (by design for simplicity)

### Network Topology

**Mesh Network**: Each participant connects directly to every other participant
- Pros: No server load for media, lowest latency, P2P privacy
- Cons: Bandwidth scales with N² (4 people = 6 connections; 8 people = 28 connections)
- Best for: Small groups (up to 6-8 participants)

### Performance Characteristics

**Bandwidth usage per peer connection**:
- Video: ~300-1000 Kbps (depends on resolution)
- Audio: ~40-100 Kbps
- For 5 participants: Each sends 4 streams, receives 4 streams
- Total per participant: ~2-4 Mbps up, ~2-4 Mbps down

**CPU usage**:
- Video encoding/decoding is CPU intensive
- Each connection requires separate encode/decode
- Mobile devices may struggle with 4+ connections

### Browser Compatibility

Works in modern browsers:
- Chrome/Edge: Full support
- Firefox: Full support
- Safari: Full support (WebKit)
- Mobile browsers: Supported with some limitations

### Production Considerations

**Missing for production use**:
1. **TURN servers**: For 100% connectivity behind restrictive NATs
2. **HTTPS**: Required for getUserMedia in production
3. **Error recovery**: More robust reconnection logic
4. **Logging**: Proper error tracking and analytics
5. **Backpressure**: Handle too many participants gracefully
6. **Quality adaption**: Adjust video quality based on bandwidth
7. **Authentication**: Optionally restrict who can join
8. **Multiple rooms**: Server supports it, but UI doesn't expose it

**TURN server setup**:
```javascript
// Would add to RTCPeerConnection config:
iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    {
        urls: 'turn:your-turn-server.com:3478',
        username: 'user',
        credential: 'pass'
    }
]
```

### Testing the Flow

To verify understanding, you can:
1. Open browser console on http://localhost:3000
2. Join from multiple tabs/devices
3. Watch console logs for socket events
4. Use `chrome://webrtc-internals/` to see detailed WebRTC stats
5. Use browser dev tools Network tab to see WebSocket messages

### Code Execution Order Example

Two users joining sequentially:

**Timeline (simplified)**:
```
T+0s:   User A clicks join
T+0.1s: getUserMedia succeeds, local video plays
T+0.2s: emit('join-call') → server
T+0.3s: server emits 'joined-call' to User A (empty list)
T+0.3s: User A receives 'joined-call', does nothing (alone)
        
T+10s:  User B clicks join
T+10.1s: getUserMedia succeeds, local video plays
T+10.2s: emit('join-call') → server
T+10.3s: server emits 'joined-call' to User B (includes User A's ID)
T+10.3s: server emits 'user-joined' to User A (includes User B's ID)

T+10.4s: User B: createPeerConnection(userA, isInitiator=true)
T+10.5s: createOffer() → offer
T+10.6s: emit('offer', userA, offer) → server
T+10.7s: User A: createPeerConnection(userB, isInitiator=false)

T+10.8s: server relays offer: emit('offer', userB, offer) → User A
T+10.9s: User A: setRemoteDescription(offer)
T+11.0s: createAnswer() → answer
T+11.1s: emit('answer', userB, answer) → server

T+11.2s: server relays answer: emit('answer', userA, answer) → User B
T+11.3s: User B: setRemoteDescription(answer)

T+11.4s: Both: ICE candidates begin flowing
T+12.0s: ontrack fires, remote video starts playing (both directions)
```

This completes the connection between two users. Each additional user repeats a similar pattern with all existing participants.
