// happy coding 👻
// console.log("hello world");

import { ServerClient } from "minecraft-protocol";
import { MyProxy, UpstreamTarget } from "./proxy/MyProxy";

let proxyOptions = {
    onlineMode: true,
    host: '0.0.0.0',
    port: 25566,
    endUpstreamWhenCommanderGone: true,
    kickCommanderWhenUpstreamEnd: true,
    kickFollowersWhenUpstreamEnd: false,
    spectatorHotbar: true,
    serverOptions: {
        version: '1.18.1'
    },
    clientOptions: {
        version: '1.18.1'
    }
}

let upstreamTarget: UpstreamTarget = {
    onlineMode: true,
    port: 25565,
    host: 'minehut.com',
    loginUser: 'tom',
    commander: [] // empty array means the one same with the loginUser
};


const proxy = new MyProxy(proxyOptions);

function mod(n: number, m: number) {
    return ((n % m) + m) % m;
}

function getRandomInt(max: number) {
    return Math.floor(Math.random() * max);
}

function allClients(): ServerClient[] {
    return Object.values(proxy.downstream.clients);
}

function allClientsExcept(sender: ServerClient | null) {
    return allClients().filter(client => client !== sender);
}

function allCommanders() {
    return allClients().filter(client => upstreamTarget.commander.includes(client.username));
}

function allFollowers() {
    return allClients().filter(client => !upstreamTarget.commander.includes(client.username));
}

function updatePlayersPositionLook(except: ServerClient[]) {
    const gamestate = proxy.gamestate;

    const yaw_a = mod(Math.floor(gamestate.coords.yaw * 256 / 360) - 128, 256) - 128;
    const pitch_a = mod(Math.floor(gamestate.coords.pitch * 256 / 360) - 128, 256) - 128;

    allClients().forEach(client => {
        if (except.includes(client)) return;
        if (upstreamTarget.commander.includes(client.username)) {
            client.write('position', {
                x: gamestate.coords.x,
                y: gamestate.coords.y,
                z: gamestate.coords.z,
                yaw: gamestate.coords.yaw,
                pitch: gamestate.coords.pitch,
                flags: 0x00,
                teleportId: 0x00,
                dismountVehicle: false
            });
        } else {
            let cameraY = gamestate.coords.y;
            let mockPlayerY = gamestate.coords.y;
            const local = proxy.downstreamGamestate[client.id];

            if (local.watchingMockPlayer) {
                mockPlayerY -= 1000;
                if (gamestate.pose == 5) cameraY -= 0.3
                else if (gamestate.pose == 3) cameraY -= 1.22;

                client.write('position', {
                    x: gamestate.coords.x,
                    y: cameraY,
                    z: gamestate.coords.z,
                    yaw: gamestate.coords.yaw,
                    pitch: gamestate.coords.pitch,
                    flags: 0x00,
                    teleportId: 0x00,
                    dismountVehicle: false
                });
            }

            client.write('entity_teleport', {
                entityId: gamestate.givenEntityId,
                x: gamestate.coords.x,
                y: mockPlayerY,
                z: gamestate.coords.z,
                yaw: yaw_a,
                pitch: pitch_a,
                onGround: gamestate.coords.onGround
            });

            client.write('entity_head_rotation', {
                entityId: gamestate.givenEntityId,
                headYaw: yaw_a
            });
        }
    });
}

function updateMockPlayerEquipment(client: ServerClient, preEqSlot: any, slotData: any) {
    if (upstreamTarget.commander.includes(client.username)) return;

    if (5 <= preEqSlot && preEqSlot <= 8)
        preEqSlot = 10 - preEqSlot;

    let eqSlot = preEqSlot;

    client.write('entity_equipment', {
        entityId: proxy.gamestate.givenEntityId,
        equipments: [{ slot: eqSlot, item: slotData }]
    });
}

function updateInventory(windowId: any, slotIdx: number, slotData: any) {
    if (windowId == 0) {
        proxy.gamestate.slots[slotIdx] = slotData;

        if (5 <= slotIdx && slotIdx <= 8)
            allClients().forEach(client => updateMockPlayerEquipment(client, slotIdx, slotData));
        else if (slotIdx == 45)
            allClients().forEach(client => updateMockPlayerEquipment(client, 1, slotData));
        else if (slotIdx - 36 == proxy.gamestate.hotbarIdx)
            allClients().forEach(client => updateMockPlayerEquipment(client, 0, slotData));
    } else if (proxy.gamestate.openingWindow.size >= 9) {
        let hotbarIdx = proxy.gamestate.openingWindow.size - (slotIdx - 9);

        if (0 <= hotbarIdx && hotbarIdx <= 9) {
            proxy.gamestate.slots[36 + hotbarIdx] = slotData;

            if (hotbarIdx == proxy.gamestate.hotbarIdx)
                allClients().forEach(client => updateMockPlayerEquipment(client, 0, proxy.gamestate.slots[36 + hotbarIdx]));
        }
    }
}

function setupMockEnviromenet(client: ServerClient) {
    if (!proxy.gamestate.myInfoRecevied) return;

    if (upstreamTarget.commander.includes(client.username)) {
        return;
    }

    const local = proxy.downstreamGamestate[client.id];

    if (local.mockInWorld) return;
    local.mockInWorld = true;

    client.write('named_entity_spawn', {
        entityId: proxy.gamestate.givenEntityId,
        playerUUID: proxy.gamestate.givenUUID,
        x: proxy.gamestate.coords.x,
        y: proxy.gamestate.coords.y,
        z: proxy.gamestate.coords.z,
        yaw: 0,
        pitch: 0 // XXX: lazy
    });

    client.write('entity_metadata', {
        entityId: local.realEntityId,
        metadata: [
            { type: 0, key: 0, value: 32 }
        ]
    })

    client.write('player_info', {
        action: 0,
        data: [
            {
                UUID: client.uuid,
                name: client.username,
                properties: [],
                gamemode: 3,
                ping: 0
            }
        ]
    });

    if (proxyOptions.spectatorHotbar) {
        client.write('game_state_change', {
            reason: 3,
            gameMode: 3
        });
    }
}



proxy.setUpstreamTarget(upstreamTarget);

proxy.on('incoming', (data, meta) => {
    const packet_name = meta.name;
    const everyone = allClients();

    if (packet_name === 'login') {
        proxy.gamestate.givenEntityId = data.entityId;
        everyone.forEach(client => {
            let eid = getRandomInt(100000) + 100000;
            if (upstreamTarget.commander.includes(client.username))
                eid = proxy.gamestate.givenEntityId;
            data.entityId = proxy.downstreamGamestate[client.id].realEntityId = eid;
            client.write('login', data);
        });
        return;
    } else if (packet_name === 'player_info') {
        if (!proxy.gamestate.myInfoRecevied && data.action == 0) {
            proxy.gamestate.myInfoRecevied = data.data.some((info: { UUID: string; }) =>
                info.UUID === proxy.gamestate.givenUUID);
        };
    } else if (packet_name === 'abilities') {
        allCommanders().forEach(client => client.write(packet_name, data));
        allFollowers().forEach(client => client.write(packet_name, { ...data, flags: 0b0010 }));
        return;
    } else if (packet_name === 'game_state_change') {
        if (proxyOptions.spectatorHotbar) {
            allCommanders().forEach(client => client.write(packet_name, data));
            return;
        }
    } else if (packet_name === 'entity_metadata') {
        if (data.entityId === proxy.gamestate.givenEntityId) {

            let pose = data.metadata.find(((meta: { key: number; type: number; }) => meta.key === 6 && meta.type === 18));
            if (pose) {
                proxy.gamestate.pose = pose.value;
                updatePlayersPositionLook(allFollowers());
            }
        }
    } else if (packet_name === 'respawn') {
        allClients().forEach(client => proxy.downstreamGamestate[client.id].mockInWorld = false);
    } else if (packet_name === 'camera') {
        proxy.downstream.writeToClients(allCommanders(), packet_name, data);
        return;
    } else if (packet_name === 'position') {
        proxy.downstream.writeToClients(allCommanders(), packet_name, data);

        allFollowers().forEach(client => {
            if (!proxy.downstreamGamestate[client.id].mockInWorld)
                client.write(packet_name, data);
            setupMockEnviromenet(client);
        });
        return;
    } else if (packet_name === 'window_items') {
        const count = data.items.length;
        proxy.gamestate.openingWindow = { windowId: data.windowId, size: count };
        if (data.windowId == 0) {
            proxy.gamestate.slots = data.items;
            allFollowers().forEach(client => {
                updateMockPlayerEquipment(client, 0, data.items[36 + proxy.gamestate.hotbarIdx]);
                updateMockPlayerEquipment(client, 1, data.items[45]);
                updateMockPlayerEquipment(client, 5, data.items[5]);
                updateMockPlayerEquipment(client, 6, data.items[6]);
                updateMockPlayerEquipment(client, 7, data.items[7]);
                updateMockPlayerEquipment(client, 8, data.items[8]);
            });
        } else if (data.items.length >= 9) {
            for (let i = count - 10; i < count - 1; i++) {
                updateInventory(data.windowId, i, proxy.gamestate.slots[i]);
            }
        }
    } else if (packet_name === 'set_slot') {
        updateInventory(data.windowId, data.slot, data.item);
    }

    proxy.downstream.writeToClients(everyone, packet_name, data);
})

proxy.on('outgoing', (data, meta, sender) => {
    const packet_name = meta.name;

    if (!upstreamTarget.commander.includes(sender.username)) {
        if (packet_name === 'use_entity') {
            proxy.downstreamGamestate[sender.id].watchingMockPlayer = data.target == proxy.gamestate.givenEntityId;
            if (!proxy.downstreamGamestate[sender.id].watchingMockPlayer)
                sender.write('camera', { entityId: data.target });
        } else if (packet_name === 'entity_action') {
            if (data.actionId == 0) { // start sneaking
                proxy.downstreamGamestate[sender.id].watchingMockPlayer = false;
                sender.write('camera', { entityId: proxy.gamestate.givenEntityId });
            }
        } else if (packet_name === 'chat') {
            if (data.message === '/tpback') {
                sender.write('position', {
                    x: proxy.gamestate.coords.x,
                    y: proxy.gamestate.coords.y,
                    z: proxy.gamestate.coords.z,
                    yaw: proxy.gamestate.coords.yaw,
                    pitch: proxy.gamestate.coords.pitch,
                    flags: 0x00,
                    teleportId: 0x00,
                    dismountVehicle: false
                })
            }
        }
        return;
    }

    const exceptMe = allClientsExcept(sender);

    if (packet_name === 'position_look') {
        proxy.gamestate.coords = { ...proxy.gamestate.coords, ...data };
        updatePlayersPositionLook([sender]);

        allClients().forEach(client => setupMockEnviromenet(client));
    } else if (packet_name === 'position') {
        proxy.gamestate.coords = { ...proxy.gamestate.coords, ...data };
        updatePlayersPositionLook([sender]);
    } else if (packet_name === 'look') {
        proxy.gamestate.coords = { ...proxy.gamestate.coords, ...data };
        updatePlayersPositionLook([sender]);
    } else if (packet_name === 'vehicle_move') {
        proxy.gamestate.coords = { ...proxy.gamestate.coords, x: data.x, y: data.y, z: data.z };
        updatePlayersPositionLook([sender]);
    } else if (packet_name === 'window_click') {
        for (let i = 0; i < data.changedSlots.length; i++) {
            exceptMe.forEach(client => {
                client.write('set_slot', {
                    windowId: data.windowId,
                    stateId: data.stateId,
                    slot: data.changedSlots[i].location,
                    item: data.changedSlots[i].item
                });
            });
        }
    } else if (packet_name === 'block_dig') {
        if (data.status == 3 || data.status == 4) {
            const slotIdx = 36 + proxy.gamestate.hotbarIdx;
            let item = proxy.gamestate.slots[slotIdx];

            if (item != undefined && item.present) {
                item.itemCount -= 1;

                if (data.status == 3 || item.itemCount == 0) {
                    item.present = false;
                    exceptMe.forEach(client => {
                        updateMockPlayerEquipment(client, 0, {});
                    });
                }

                exceptMe.forEach(client => {
                    client.write('set_slot', {
                        windowId: data.windowId,
                        stateId: data.stateId,
                        slot: slotIdx,
                        item
                    });
                });
            }
        }
    } else if (packet_name === 'close_window') {
        exceptMe.forEach(client => {
            client.write('close_window', data); // same as downstream
        });
    } else if (packet_name === 'held_item_slot') {
        proxy.gamestate.hotbarIdx = data.slotId;
        let slotIdx = 36 + data.slotId;
        let slotData = slotIdx < proxy.gamestate.slots.length ? proxy.gamestate.slots[slotIdx] : null;

        exceptMe.forEach(client => {
            client.write('held_item_slot', { slot: data.slotId });
            if (slotData != null)
                updateMockPlayerEquipment(client, 0, slotData);
        });
    } else if (packet_name === 'arm_animation') {
        const hand = data.hand;

        exceptMe.forEach(client => {
            client.write('animation', { entityId: proxy.gamestate.givenEntityId, animation: hand === 1 ? 3 : 0 });
            client.write('animation', { entityId: proxy.downstreamGamestate[client.id].realEntityId, animation: hand === 1 ? 3 : 0 });
        });
    }
    // console.log(meta, data);

    proxy.upstream?.write(meta.name, data);
});
