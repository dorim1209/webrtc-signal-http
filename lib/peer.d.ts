import { IBuffer, IPeerResponse } from "./utils";
export default class Peer {
    private _name;
    private _id;
    private _buffer;
    private _res;
    private _ip;
    constructor(name: string, id: number);
    name: string;
    id: number;
    buffer: IBuffer[];
    res: IPeerResponse;
    ip: string;
    status(): boolean;
}
