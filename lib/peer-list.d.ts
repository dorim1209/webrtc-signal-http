/// <reference types="node" />
import { EventEmitter } from "events";
import Peer from "./peer";
import { IPeerRequest, IPeerResponse } from "./utils";
export default class PeerList extends EventEmitter {
    private _peers;
    private _nextPeerId;
    constructor();
    addPeer(name: string, res: IPeerResponse, req: IPeerRequest): number;
    removePeer(id: number): void;
    getPeer(id: number): Peer;
    getPeerIds(): number[];
    setPeerSocket(id: number, res: IPeerResponse, req: IPeerRequest): void;
    pushPeerData(srcId: number, destId: number, data: any): void;
    popPeerData(id: number): import("./utils").IBuffer;
    readonly peers: Peer[];
    format(): string;
    dataFor(id: number | string): string;
}
