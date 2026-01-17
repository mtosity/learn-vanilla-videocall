const express = require('express')
const http = require('http')
const socketIo = require('socket.io')

const app = express()
const server = http.createServer(app)
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
})

app.use(express.static('public'))

const rooms = new Map()

io.on('connection', (socket) => {
  console.log('User connected:', socket.id)

  socket.on('join-call', (roomId, userName) => {
    socket.join(roomId)
    
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set())
    }
    
    rooms.get(roomId).add({ id: socket.id, name: userName })
    
    const otherParticipants = Array.from(rooms.get(roomId))
      .filter(p => p.id !== socket.id)
      .map(p => p.id)
    
    socket.emit('joined-call', otherParticipants)
    socket.to(roomId).emit('user-joined', socket.id, userName)
  })

  socket.on('offer', (targetId, offer) => {
    io.to(targetId).emit('offer', socket.id, offer)
  })

  socket.on('answer', (targetId, answer) => {
    io.to(targetId).emit('answer', socket.id, answer)
  })

  socket.on('ice-candidate', (targetId, candidate) => {
    io.to(targetId).emit('ice-candidate', socket.id, candidate)
  })

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id)
    
    for (const [roomId, participants] of rooms) {
      const participantToRemove = Array.from(participants).find(p => p.id === socket.id)
      if (participantToRemove) {
        participants.delete(participantToRemove)
        socket.to(roomId).emit('user-left', socket.id)
        
        if (participants.size === 0) {
          rooms.delete(roomId)
        }
        break
      }
    }
  })
})

const PORT = process.env.PORT || 3000
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})
