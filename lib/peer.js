"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class Peer {
  constructor(type, broadcastStatus, name, id) {
    this._type = type;
    this._broadcastStatus = broadcastStatus;
    this._name = name;
    this._id = id;
    this._buffer = [];
    this._res = null;
  }
  get type() {
    return this._type;
  }
  set type(type) {
    throw new Error("Immutable");
  }
  get broadcastStatus() {
    return this._broadcastStatus;
  }
  set broadcastStatus(broadcastStatus) {
    this._broadcastStatus = broadcastStatus;
  }
  get name() {
    return this._name;
  }
  set name(name) {
    throw new Error("Immutable");
  }
  get id() {
    return this._id;
  }
  set id(id) {
    throw new Error("Immutable");
  }
  get buffer() {
    return this._buffer;
  }
  set buffer(buffer) {
    throw new Error("Immutable");
  }
  get res() {
    return this._res;
  }
  set res(res) {
    this._res = res;
  }
  set ip(ip) {
    this._ip = ip;
  }
  get ip() {
    return this._ip;
  }
  status() {
    return this._res != null && this._res.socket != null && this._res.socket.writable;
  }
}
exports.default = Peer;
//# sourceMappingURL=peer.js.map
