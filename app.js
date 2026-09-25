const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const generateRoomCode = require("./utils/code");

const app = express();
const server = http.Server(app);

const PORT = process.env.PORT || 3006;

const io = new Server(server, {
    cors: {
        origin: [
            "https://jogo-da-velha.fun/",
        ],
    },
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res) => {
    res.status(404).json({
        error: "Not Found",
    });
});

app.use((err, req, res, next) => {
    console.error(err);

    res.status(err.status || 500).json({
        error: "Internal Server Error",
    });
});

const partidas = new Map();

const vitoria = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6]
]

function verificarVitoria(board, jogador) {
    // Retorna a combinação vencedora do jogador, por exemplo [0, 4, 8].
    // Se nenhuma combinação estiver totalmente ocupada por ele, retorna undefined.
    return vitoria.find(
        (combinacao) => combinacao
        .every(
            (posicao) => board[posicao] === jogador
        )
    );
}

const checkCode = () => {
    let code;

    do {
        code = generateRoomCode();
    } while (partidas.has(code));

    console.log("Generated Room Code: ", code);
    return code;
};

io.on("connection", (socket) => {
    socket.on("create-game", () => {
        console.log("Nova conexão com Jogo Criado : ", socket.id);
        const roomCode = checkCode();
        partidas.set(roomCode, {
            board: Array(9).fill(null),
            players: {
                X: socket.id,
                O: null,
            },
            turn: "X",
            winner: null,
            status: "waiting",
        });
        socket.join(roomCode);
    
        socket.emit("game-created", roomCode);
    });

    socket.on('join-game', (roomCode) => {
        console.log(`Jogador ${socket.id} tentando entrar na partida ${roomCode}`);
        const partida = partidas.get(roomCode);

        if (!partida || partida === undefined) {
            socket.emit('error', 
                {
                    'type': 'not-found',
                    'message': 'Partida não encontrada'
                });
            return;
        }

        if (partida.players.O) {
            socket.emit('error', {
                type: 'full',
                message: 'Partida já está cheia'
            });
            return;
        }

        partida.players.O = socket.id;
        partida.status = 'playing';
        socket.join(roomCode);

        io.to(partida.players.X).emit('player-joined', 'Partida iniciada! É a sua vez de jogar.');
        io.to(roomCode).emit('game-ready', roomCode);
    });

    socket.on('play-again', (roomCode) => {
        const partida = partidas.get(roomCode);
        
        if (!partida) {
            socket.emit('error', 'Partida não encontrada');
            return;
        }

        const jogador = socket.id === partida.players.X ? 'X' : 'O';
        
        console.log(`Jogador ${jogador} solicitou reinício da partida ${roomCode}`);
        
        if (partida.status !== 'finished') {
            socket.emit('error', 'Partida ainda não terminou');
            return;
        }

        const outroJogador = jogador === 'X' ? partida.players.O : partida.players.X;

        io.to(outroJogador).emit('accept-restart');

        console.log(`Reiniciando partida ${roomCode}`);
    });

    socket.on('accepted', (roomCode) => {
        const partida = partidas.get(roomCode);
        if (!partida) {
            socket.emit('error', {
                type: 'not-found',
                message: 'Partida não encontrada'
            });
            return;
        }
        console.log(`Jogador ${socket.id} aceitou reiniciar a partida ${roomCode}`);
        partida.board = Array(9).fill(null);
        partida.turn = 'X';
        partida.winner = null;
        partida.status = 'playing';

        io.to(roomCode).emit('reload-game', {
            board: partida.board,
            turn: partida.turn
        });
        console.log(`Partida ${roomCode} reiniciada`);
    });

    socket.on('declined', (roomCode) => {
        const partida = partidas.get(roomCode);
        if (!partida) {
            socket.emit('error', {
                type: 'not-found',
                message: 'Partida não encontrada'
            });
            return;
        }
        const jogador = socket.id === partida.players.X ? 'X' : 'O';

        io.to(roomCode).emit('restart-game-declined');
        console.log(`Partida ${roomCode} encerrada pelo jogador ${jogador}`);
        partidas.delete(roomCode);
    });

    socket.on('play', (jogada) => {
        const partida = partidas.get(jogada.gameCode);

        if (!partida) {
            socket.emit('play-error', {
                type: 'not-found',
                message: 'Partida não encontrada.'
            });
            return;
        }
        
        const jogador = socket.id === partida.players.X ? 'X' : socket.id === partida.players.O ? 'O' : null;
        if (jogador === null) {
            socket.emit('play-error', {
                type: 'not-player',
                message: 'Você não é um jogador desta partida'
            });
            return;
        }

        const outroJogador = jogador === 'X' ? partida.players.O : partida.players.X;
        if (partida.status === 'waiting' && outroJogador === null) {
            socket.emit('play-error', {
                type: 'missing-player',
                message: `Aguardando jogador ${jogador === 'X' ? 'O' : 'X'} entrar na partida`
            });
            return;
        }

        if (partida.status === 'finished') {
            socket.emit('play-error', {
                type: 'finished',
                message: 'Partida já foi finalizada, você pode pedir pra jogar novamente ou fazer reload para nova partida.'
            });
            return;
        }

        const posicao = jogada.position;

        if (!Number.isInteger(posicao) || (posicao < 0 || posicao > 8)) {
            console.log(`Tentativa de jogada inválida: jogador ${jogador}, posição ${posicao}`);
            return;
        }

        console.log(`Tentativa de jogada: jogador ${jogador}, posição ${posicao}`);

        if (partida.turn !== jogador) {
            socket.emit('play-error', {
                type: 'turn',
                turn: partida.turn
            });
            return;
        }
        if (partida.board[posicao] !== null) {
            socket.emit('play-error', {
                type: 'occupied',
                position: posicao
            });
            return;
        }

        partida.board[posicao] = jogador;
        partida.turn = jogador === 'X' ? 'O' : 'X';

        const seqVitoria = verificarVitoria(
            partida.board,
            jogador
        )

        io.to(jogada.gameCode).emit('game-state', {
            board: partida.board,
            turn: partida.turn
        });

        const empate = partida.board.every(
            posicao => posicao !== null
        );

        if (empate) {
            partida.status = 'finished';

            io.to(jogada.gameCode).emit('game-over', {
                winner: null,
                winningSequence: null,
                board: partida.board
            });
            console.log('Partida terminou empatada');
            return;
        }

        if (seqVitoria) {
            partida.winner = jogador;
            partida.status = 'finished';

            io.to(jogada.gameCode).emit('game-over', {
                winner: jogador,
                winningSequence: seqVitoria,
                board: partida.board
            });
            console.log(`Vitória do jogador ${jogador}`);
            return;
        }
    });

    socket.on('disconnect', () => {
        console.log(`Jogador ${socket.id} desconectou`);

        for (const [roomCode, partida] of partidas) {
            const jogador =
                partida.players.X === socket.id
                    ? 'X'
                    : partida.players.O === socket.id
                        ? 'O'
                        : null;

            if (jogador === null) {
                continue;
            }

            const outroJogador =
                jogador === 'X'
                    ? partida.players.O
                    : partida.players.X;

            if (outroJogador) {
                io.to(outroJogador).emit('opponent-disconnected', {
                    message: `O jogador ${jogador} desconectou. A partida foi encerrada.`,
                });
            }

            partidas.delete(roomCode);

            console.log(
                `Partida ${roomCode} encerrada devido à desconexão do jogador ${socket.id}`
            );
            break;
        }
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log('Jogo escutando na porta ' + PORT + ' -...');
});