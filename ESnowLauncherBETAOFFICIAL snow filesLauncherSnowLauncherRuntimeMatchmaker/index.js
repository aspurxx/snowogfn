// Syndicate: a closed launcher pipe must never stop matchmaking.
for (const stream of [process.stdout, process.stderr]) { try { stream.on("error", () => {}); } catch {} }
const { Server: WebSocket } = require("ws");
const crypto = require("crypto");
const playlists=require("./playlists.cjs");

// Start listening websocket on port
const port = Number(process.env.TILTED_MATCHMAKER_PORT || 6969);
const wss = new WebSocket({ port: port });

wss.on('listening', () => {
    console.log(`Matchmaker started listening on port ${port}`);
});

wss.on('connection', async (ws,request) => {
    const id=new URL(request.url,'http://localhost').searchParams.get('ticket');
    const ticket=playlists.readTicket(id);
    if(!ticket){ws.close(1008,'A playlist matchmaking ticket is required');return;}
    let played=false;
    if (ws.protocol.toLowerCase().includes("xmpp")) {
        return ws.close();
    }

    // create hashes
    const ticketId = crypto.createHash('md5').update(`1${Date.now()}`).digest('hex');
    const matchId = crypto.createHash('md5').update(`2${Date.now()}`).digest('hex');
    const sessionId = ticket.id;

    // you can use setTimeout to send the websocket messages at certain times
    const timers = [
        // Quick queue: the status steps used to take 6 s before the host was even checked.
        setTimeout(Connecting, 100),
        setTimeout(Waiting, 300),
        setTimeout(Queued, 600),
        setTimeout(WaitForHost, 1000)
    ];
    ws.on('close', () => {timers.forEach(clearTimeout);if(!played)void playlists.releaseTicket(ticket.id,false);});
    ws.on('error', () => timers.forEach(clearTimeout));

    function Connecting() {
        ws.send(JSON.stringify({
            "payload": {
                "state": "Connecting"
            },
            "name": "StatusUpdate"
        }));
    }

    function Waiting() {
        ws.send(JSON.stringify({
            "payload": {
                "totalPlayers": 1,
                "connectedPlayers": 1,
                "state": "Waiting"
            },
            "name": "StatusUpdate"
        }));
    }

    function Queued() {
        ws.send(JSON.stringify({
            "payload": {
                "ticketId": ticketId,
                "queuedPlayers": 0,
                "estimatedWaitSec": 0,
                "status": {},
                "state": "Queued"
            },
            "name": "StatusUpdate"
        }));
    }

    // A first start can take several minutes while antivirus scans the game (launcher retries once).
    const deadline=Date.now()+600000;
    async function WaitForHost(){
        if(ws.readyState!==1)return;
        const error=playlists.ticketError(ticket.id);if(error){ws.close(1013,require('./startup-errors.cjs').publicReason(error));return;}
        if(Date.now()>deadline){ws.close(1013,'Match server not ready; please retry');return;}
        if(!await playlists.ticketReady(ticket.id)){Queued();timers.push(setTimeout(WaitForHost,500));return;}
        SessionAssignment();timers.push(setTimeout(Join,500));
    }
    function SessionAssignment() {
        ws.send(JSON.stringify({
            "payload": {
                "matchId": matchId,
                "state": "SessionAssignment"
            },
            "name": "StatusUpdate"
        }));
    }

    async function Join() {
        if(ws.readyState!==1)return;
        if(!await playlists.ticketReady(ticket.id)){WaitForHost();return;}
        await playlists.releaseTicket(ticket.id,true);played=true;
        if(ws.readyState!==1)return;
        ws.send(JSON.stringify({
            "payload": {
                "matchId": matchId,
                "sessionId": sessionId,
                "joinDelaySec": 1
            },
            "name": "Play"
        }));
        // Older clients finalize the assignment when the matchmaking socket closes.
        setTimeout(() => { if (ws.readyState === 1) ws.close(1000); }, 1000);
    }
});
