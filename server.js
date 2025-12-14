const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const rooms = {};

// =====================
// UTILIDADES
// =====================
function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// =====================
// RUTAS HTTP
// =====================
app.post('/api/create', (req, res) => {
  const { game, host } = req.body;
  const code = generateCode();

  rooms[code] = {
    code,
    game,
    status: 'waiting',
    players: [],
    gameData: {},
    createdAt: Date.now()
  };

  res.json({ code });
});

app.get('/room/:code', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'room.html'));
});

// =====================
// SOCKET.IO
// =====================
io.on('connection', (socket) => {

  // -------- UNIRSE A SALA --------
  socket.on('join-room', ({ code, playerName }) => {
    const room = rooms[code];
    if (!room) {
      socket.emit('error', 'Sala no encontrada');
      return;
    }

    if (room.players.find(p => p.id === socket.id)) return;

    room.players.push({
      id: socket.id,
      name: playerName,
      score: 0
    });

    socket.join(code);
    io.to(code).emit('room-update', room);
  });

  // -------- INICIAR JUEGO --------
  socket.on('start-game', (code) => {
    const room = rooms[code];
    if (!room) return;

    // Solo el host (primer jugador)
    if (room.players[0].id !== socket.id) return;

    room.status = 'playing';

    // ===== IMPOSTOR =====
    if (room.game === 'impostor') {
      const words = ['PERRO', 'PLAYA', 'COCHE', 'PIZZA', 'MONTAÑA'];
      const secret = words[Math.floor(Math.random() * words.length)];
      const impostorIndex = Math.floor(Math.random() * room.players.length);

      room.players.forEach((p, i) => {
        p.word = i === impostorIndex ? 'IMPOSTOR' : secret;
      });

      room.gameData = {
        phase: 'answering',
        answers: [],
        votes: []
      };
    }

    // ===== VOTING =====
    if (room.game === 'voting') {
      const questions = [
        '¿Quién llega siempre tarde?',
        '¿Quién es más probable que gane la lotería?',
        '¿Quién se duerme en clase?'
      ];

      room.gameData = {
        phase: 'voting',
        question: questions[Math.floor(Math.random() * questions.length)],
        votes: [],
        results: []
      };
    }

    // ===== TRIVIA =====
    if (room.game === 'trivia') {
      room.gameData = {
        phase: 'question',
        currentQuestion: 0,
        answers: [],
        questions: [
          {
            question: '¿Capital de Francia?',
            options: ['Roma', 'Madrid', 'París', 'Berlín'],
            correct: 2
          },
          {
            question: '¿Cuántos planetas hay?',
            options: ['7', '8', '9', '10'],
            correct: 1
          }
        ]
      };
    }

    io.to(code).emit('game-started', room);
  });

  // -------- RESPUESTAS --------
  socket.on('submit-answer', ({ code, answer }) => {
    const room = rooms[code];
    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    // ===== IMPOSTOR =====
    if (room.game === 'impostor') {
      if (room.gameData.phase === 'answering') {
        if (room.gameData.answers.find(a => a.playerId === player.id)) return;

        room.gameData.answers.push({
          playerId: player.id,
          playerName: player.name,
          answer
        });

        if (room.gameData.answers.length === room.players.length) {
          room.gameData.phase = 'voting';
        }
      } 
      else if (room.gameData.phase === 'voting') {
        room.gameData.votes.push(answer);
      }
    }

    // ===== VOTING =====
    if (room.game === 'voting') {
      if (room.gameData.phase === 'voting') {
        room.gameData.votes.push(answer);

        if (room.gameData.votes.length === room.players.length) {
          const counts = {};
          room.gameData.votes.forEach(v => counts[v] = (counts[v] || 0) + 1);

          room.gameData.results = Object.entries(counts)
            .map(([id, votes]) => ({
              player: room.players.find(p => p.id === id),
              votes
            }))
            .sort((a, b) => b.votes - a.votes);

          room.gameData.phase = 'results';
        }
      }
    }

    // ===== TRIVIA =====
    if (room.game === 'trivia') {
      if (room.gameData.answers.find(a => a.playerId === player.id)) return;

      room.gameData.answers.push({
        playerId: player.id,
        answerIndex: answer
      });
    }

    io.to(code).emit('room-update', room);
  });

  // -------- SIGUIENTE RONDA --------
  socket.on('next-round', (code) => {
    const room = rooms[code];
    if (!room) return;

    if (room.game === 'trivia') {
      room.gameData.currentQuestion++;
      room.gameData.answers = [];
    }

    if (room.game === 'voting') {
      room.gameData.phase = 'voting';
      room.gameData.votes = [];
    }

    io.to(code).emit('room-update', room);
  });

  // -------- DESCONEXIÓN --------
  socket.on('disconnect', () => {
    for (const code in rooms) {
      const room = rooms[code];
      const index = room.players.findIndex(p => p.id === socket.id);
      if (index !== -1) {
        room.players.splice(index, 1);
        io.to(code).emit('room-update', room);
        if (room.players.length === 0) delete rooms[code];
      }
    }
  });
});

// =====================
// INICIAR SERVIDOR
// =====================
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`🎮 PlayLAN activo en http://localhost:${PORT}`);
});
