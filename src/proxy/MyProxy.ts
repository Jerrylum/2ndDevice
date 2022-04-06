import EventEmitter from 'events';
import { createServer, createClient, Server, ServerClient, PromiseLike, Client, PacketMeta, ServerOptions, ClientOptions } from 'minecraft-protocol';

const LOGIN_STATE = 'login', PLAY_STATE = 'play';

export interface ProxyOptions {
    onlineMode: boolean;
    port: number;
    host: string;
    endUpstreamWhenCommanderGone: boolean;
    kickCommanderWhenUpstreamEnd: boolean;
    kickFollowersWhenUpstreamEnd: boolean;
    spectatorHotbar: boolean;
    serverOptions?: Partial<ServerOptions>;
    clientOptions?: Partial<ClientOptions>;
}

export interface UpstreamTarget {
    onlineMode: boolean;
    port: number;
    host: string;
    loginUser: string;
    commander: string[];
}

export class DownstreamGamestate {
    realEntityId = 0;
    watchingMockPlayer = false;
    mockInWorld = false;
}

export class UpstreamGamestate {
    givenEntityId = 0;
    givenName = 'Steve';
    givenUUID = '00000000-0000-0000-0000-000000000000';
    myInfoRecevied = false;
    coords = {x: 0, y: 0, z: 0, yaw: 0, pitch: 0, onGround: false};
    pose = 0; // standing...
    slots = new Array(45);
    hotbarIdx = 0;
    openingWindow = {windowId: -1, size: 100};
}

export declare interface MyProxy {
    on(event: 'incoming', handler: (data: any, packetMeta: PacketMeta) => PromiseLike): this
    on(event: 'outgoing', handler: (data: any, packetMeta: PacketMeta, downstreamClient: ServerClient) => PromiseLike): this
}

export class MyProxy extends EventEmitter {
    options: ProxyOptions;
    downstream: Server;
    upstream?: Client;
    upstreamTarget?: UpstreamTarget;
    
    // downstreamEntityId: {[key: number]: number} = {};
    downstreamGamestate: {[key: number]: DownstreamGamestate} = {};
    gamestate = new UpstreamGamestate();

    constructor(options: ProxyOptions) {
        super()
        this.options = options
        this.downstream = createServer({
            port: options.port,
            host: options.host,
            keepAlive: false,
            'online-mode': options.onlineMode,
            ...this.options.serverOptions
        })
        this.downstream.on('login', client => this.onLogin(client))
        this.downstream.on('error', (error) => { console.log('downsteam error:', error) });
        this.downstream.on('listening', () => { console.log('downsteam listening') });
    }

    setUpstreamTarget(target: UpstreamTarget) {
        // TODO disconnect first?
        if (target.commander.length === 0)
            target.commander = [target.loginUser];
        this.upstreamTarget = target
    }

    connectUpstream() {
        if (this.upstreamTarget === undefined) return;

        this.disconnectUpstream();

        const connectedClients = Object.values(this.downstream.clients);
        let canStart = this.upstreamTarget.commander.every(name =>
            connectedClients.some(client => client.username === name));
        if (!canStart) return;

        this.upstream = createClient({
            username: this.upstreamTarget.loginUser,
            skipValidation: !this.upstreamTarget.onlineMode,
            auth: this.upstreamTarget.onlineMode ? 'microsoft' : undefined,
            port: this.upstreamTarget.port,
            host: this.upstreamTarget.host,
            keepAlive: false,
            ...this.options.clientOptions,
        });

        this.upstream.on('packet', (data, meta) => {
            if (meta.state === LOGIN_STATE && this.upstream?.state === LOGIN_STATE) {
                if (meta.name === 'success') {
                    this.gamestate.givenName = data.username;
                    this.gamestate.givenUUID = data.uuid;
                }
            } else if (meta.state === PLAY_STATE && this.upstream?.state === PLAY_STATE) {
                // from Client to Server
                this.emit('incoming', data, meta)
            }

        });
        this.upstream.on('connect', () => { console.log('connected to upstream'); });
        this.upstream.on('session', () => { console.log('successful authentication'); });
        this.upstream.on('end', (reason) => {
            console.log('disconnected from upstream | reason:', reason);

            Object.values(this.downstream.clients).forEach(client => {
                let isCommander = this.upstreamTarget?.commander.includes(client.username);
                if ((this.options.kickCommanderWhenUpstreamEnd && isCommander) || this.options.kickFollowersWhenUpstreamEnd)
                    client.end(reason);
            });
        });

        this.gamestate = new UpstreamGamestate();

        console.log('connecting to upstream');
    }

    disconnectUpstream() {
        if (this.upstreamTarget === undefined) return;

        if (this.upstream === undefined) return;

        this.upstream.end();
    }

    onLogin(downstreamClient: ServerClient): PromiseLike {
        console.log('downstream login', downstreamClient.username);

        this.downstreamGamestate[downstreamClient.id] = new DownstreamGamestate();

        downstreamClient.on('packet', (data, meta) => {
            if (meta.state === PLAY_STATE && downstreamClient.state === PLAY_STATE) {
                // from Server to Client
                this.emit('outgoing', data, meta, downstreamClient)
            }
        });
        downstreamClient.on('end', (reason) => {
            console.log('downstream end', downstreamClient.username, '| reason:', reason);

            if (this.options.endUpstreamWhenCommanderGone) {
                let hasCommander = Object.values(this.downstream.clients).some(client =>
                    this.upstreamTarget?.commander.includes(client.username));
                if (!hasCommander) this.disconnectUpstream();
            }
        });

        // auto start
        this.connectUpstream();
    }

}


export default MyProxy;