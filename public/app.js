const socket = io()
const roomId = 'default-room'

const nameInput = document.getElementById('name-input')
const joinBtn = document.getElementById('join-btn')
const leaveBtn = document.getElementById('leave-btn')
const setupContainer = document.getElementById('setup-container')
const callContainer = document.getElementById('call-container')
const localVideo = document.getElementById('local-video')
const remoteVideosContainer = document.getElementById('remote-videos')

let localStream
const peers = new Map()

joinBtn.addEventListener('click', joinCall)
leaveBtn.addEventListener('click', leaveCall)

async function joinCall() {
    const userName = nameInput.value.trim()
    if (!userName) {
        alert('Please enter your name')
        return
    }

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        localVideo.srcObject = localStream

        setupContainer.style.display = 'none'
        callContainer.style.display = 'block'

        socket.emit('join-call', roomId, userName)
    } catch (error) {
        console.error('Error accessing media devices:', error)
        alert('Could not access camera/microphone')
    }
}

function leaveCall() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop())
    }

    peers.forEach(peer => {
        if (peer.connection) {
            peer.connection.close()
        }
        if (peer.videoElement) {
            peer.videoElement.remove()
        }
    })
    peers.clear()

    setupContainer.style.display = 'block'
    callContainer.style.display = 'none'
    nameInput.value = ''

    socket.disconnect()
    socket.connect()
}

socket.on('joined-call', async (otherParticipants) => {
    for (const participantId of otherParticipants) {
        createPeerConnection(participantId, true)
    }
})

socket.on('user-joined', async (participantId) => {
    createPeerConnection(participantId, false)
})

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

socket.on('offer', async (fromId, offer) => {
    const peer = peers.get(fromId)
    if (peer) {
        await peer.connection.setRemoteDescription(offer)
        const answer = await peer.connection.createAnswer()
        await peer.connection.setLocalDescription(answer)
        socket.emit('answer', fromId, answer)
    }
})

socket.on('answer', async (fromId, answer) => {
    const peer = peers.get(fromId)
    if (peer) {
        await peer.connection.setRemoteDescription(answer)
    }
})

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

async function createPeerConnection(peerId, isInitiator) {
    const peerConnection = new RTCPeerConnection({
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    })

    const videoElement = document.createElement('video')
    videoElement.autoplay = true
    videoElement.playsInline = true
    remoteVideosContainer.appendChild(videoElement)

    peers.set(peerId, { connection: peerConnection, videoElement })

    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream)
    })

    peerConnection.ontrack = (event) => {
        videoElement.srcObject = event.streams[0]
    }

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', peerId, event.candidate)
        }
    }

    peerConnection.oniceconnectionstatechange = () => {
        if (peerConnection.iceConnectionState === 'disconnected' || 
            peerConnection.iceConnectionState === 'failed') {
            videoElement.remove()
            peers.delete(peerId)
        }
    }

    if (isInitiator) {
        const offer = await peerConnection.createOffer()
        await peerConnection.setLocalDescription(offer)
        socket.emit('offer', peerId, offer)
    }
}
