const WebSocket = require('ws');
const http = require('http');

const server = http.createServer();
const wss = new WebSocket.Server({ server });

// 플레이어 관리
let players = {};
let playerColors = {};
let playerIps = {}; // 플레이어 IP 저장 객체 추가
let playerLastActive = {}; // 플레이어 마지막 활동 시간 추적

// 플레이어 상태 감시 함수 (10초마다 실행)
setInterval(() => {
    const now = Date.now();
    const playersToRemove = [];
    
    // 비활성 플레이어 확인 (연결이 끊긴 경우만)
    Object.keys(players).forEach(playerId => {
        const player = players[playerId];
        if (player.connectionClosed && now - player.lastActive > 5000) {
            playersToRemove.push(playerId);
        }
    });
    
    // 비활성 플레이어 제거
    playersToRemove.forEach(playerId => {
        console.log(`플레이어 제거: ${players[playerId]?.name || 'Unknown'} (${playerId})`);
        delete players[playerId];
        delete playerColors[playerId];
        delete playerIps[playerId];
    });
    
    // 변경사항이 있으면 브로드캐스트
    if (playersToRemove.length > 0) {
        broadcast({
            type: 'playerList',
            players: Object.values(players),
            playerColors: playerColors
        });
        broadcastPlayerCount();
    }
}, 10000); // 10초마다 실행

wss.on('connection', (ws, req) => {
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    console.log(`새로운 클라이언트 연결: ${clientIp}`);

    // 플레이어 객체에 웹소켓 참조 추가
    const player = {
        ws: ws,
        ip: clientIp,
        lastActive: Date.now()
    };
	
    // 초기 플레이어 목록 전송
    ws.send(JSON.stringify({
        type: 'playerList',
        players: Object.values(players),
        playerColors: playerColors  // 플레이어 색상 정보 추가
    }));

    // 플레이어 수 전송
    broadcastPlayerCount();

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            switch (data.type) {
                case 'register':
                    // 새 플레이어 등록
                    const playerData = data.player;
                    players[playerData.id] = {
                        ...playerData,
                        ...player, // 웹소켓과 IP 포함
                        connectionClosed: false
                    };
                    playerColors[playerData.id] = playerData.color;
                    playerIps[playerData.id] = clientIp;
                    players[player.id] = player;
                    playerLastActive[player.id] = Date.now(); // 활동 시간 기록
                    
                    // 모든 클라이언트에게 플레이어 목록 업데이트
                    broadcast({
                        type: 'playerList',
                        players: Object.values(players).map(p => ({
                            id: p.id,
                            name: p.name,
                            color: p.color
                        }))
                    });
                    broadcastPlayerCount();
                    break;
                    
                case 'noteOn':
                case 'noteOff':
                case 'chat':
                    // 활동 시간 업데이트
                    if (data.playerId) {
                        playerLastActive[data.playerId] = Date.now();
                    }
                    
                    // 다른 모든 클라이언트에게 메시지 전달
                    broadcast(data);
                    break;
                case 'keyActive':  // 새 메시지 타입 추가
                case 'keyInactive':  // 새 메시지 타입 추가
                    // 다른 모든 클라이언트에게 메시지 전달
                    broadcast(data);
                    break;
                    
                case 'playerCount':
                    // 플레이어 수 요청에 응답
                    ws.send(JSON.stringify({
                        type: 'playerCount',
                        count: Object.keys(players).length
                    }));
                    break;
            }
        } catch (e) {
            console.error('메시지 파싱 오류:', e);
        }
    });

    ws.on('close', () => {
        console.log('클라이언트 연결 해제');
        
        // 연결이 끊긴 플레이어 표시
        Object.keys(players).forEach(playerId => {
            if (players[playerId].ws === ws) {
                players[playerId].connectionClosed = true;
                players[playerId].lastActive = Date.now();
            }
        });
    });
});

// 모든 클라이언트에게 메시지 브로드캐스트
function broadcast(data) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

// 플레이어 수 브로드캐스트
function broadcastPlayerCount() {
    broadcast({
        type: 'playerCount',
        count: Object.keys(players).length
    });
}

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`서버가 ${PORT} 포트에서 실행 중입니다.`);
});
