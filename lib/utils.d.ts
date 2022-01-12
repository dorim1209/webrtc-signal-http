import { Request, Response, Router } from "express";
import PeerList from "./peer-list";
export declare enum SignalEvent {
    PrePeerAdd = "addPeer:pre",
    PeerAdd = "addPeer",
    PostPeerAdd = "addPeer:post",
    PrePeerRemove = "RemovePeer:pre",
    PeerRemove = "RemovePeer",
    PostPeerRemove = "RemovePeer:post"
}
export interface IRouter extends Router {
    peerList: PeerList;
}
export interface IRouterOpts {
    enableCors?: boolean;
    enableLogging?: boolean;
    peerList?: PeerList;
}
export interface IBuffer {
    data: any;
    srcId: number;
}
export interface IPeerResponse extends Response {
    socket?: {
        writable: boolean;
    };
    realIp?: string;
}
export interface IPeerRequest extends Request {
    realIp?: string;
}
export declare function optIsFalsey(opt: string | boolean): boolean;