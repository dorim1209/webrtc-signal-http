"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const events_1 = require("events");
const peer_1 = require("./peer");
const utils_1 = require("./utils");

class PeerList extends events_1.EventEmitter {
  constructor() {
    super();
    this._peers = [];
    this._nextPeerId = 1;
  }
  addPeer(type, broadcastStatus, name, res, req) {
    this.emit(utils_1.SignalEvent.PrePeerAdd, type, name);
    const peer = new peer_1.default(type, broadcastStatus, name, this._nextPeerId);
    peer.res = res;
    peer.ip = req.realIp || req.ip;
    this.emit(utils_1.SignalEvent.PeerAdd, peer);
    this._peers[peer.id] = peer;
    this._nextPeerId += 1;
    this.emit(utils_1.SignalEvent.PostPeerAdd, peer);
    return peer.id;
  }
  updatePeer(id, broadcastStatus) {
    this._peers[id].broadcastStatus = broadcastStatus;
    return this._peers[id];
  }
  removePeer(id) {
    this.emit(utils_1.SignalEvent.PrePeerRemove, id);
    if (this._peers[id]) {
      const cpy = this._peers[id];
      this.emit(utils_1.SignalEvent.PeerRemove, cpy);
      delete this._peers[id];
      this.emit(utils_1.SignalEvent.PostPeerRemove, cpy);
    }
  }
  getPeer(id) {
    return this._peers[id];
  }
  getPeerIds() {
    return Object.keys(this._peers).map(Number);
  }
  setPeerSocket(id, res, req) {
    if (this._peers[id]) {
      this._peers[id].res = res;
      this._peers[id].ip = req.realIp || req.ip;
    }
  }
  pushPeerData(srcId, destId, data) {
    if (this._peers[destId] && !this._peers[destId].status()) {
      this._peers[destId].buffer.push({
        data,
        srcId,
      });
    }
  }
  popPeerData(id) {
    if (this._peers[id] && this._peers[id].buffer.length > 0) {
      return this._peers[id].buffer.pop();
    }
  }
  // NEW
  shiftPeerData(id) {
    if (this._peers[id] && this._peers[id].buffer.length > 0) {
      return this._peers[id].buffer.shift();
    }
  }
  get peers() {
    return this._peers;
  }
  // ORIGINAL
  format() {
    // we reverse iterate over the keys because they'll be ordered by id
    // and the latest peer will always have the highest id, and we always
    // want that peer to appear first in the list
    return (
      Object.keys(this._peers)
        .reverse()
        .map((key) => {
          const e = this._peers[parseInt(key, 10)];
          return `${e.name},${e.id},${e.status() ? 1 : 0},${e.type},${e.broadcastStatus}`;
        })
        .join("\n") + "\n"
    );
  }

  // NEW
  objFormat() {
    // we reverse iterate over the keys because they'll be ordered by id
    // and the latest peer will always have the highest id, and we always
    // want that peer to appear first in the list
    let peerList = [];

    // let peerIdArray = [];
    // peerIdArray = Object.keys(this._peers).reverse();
    // peerIdArray.map((key) => {
    Object.keys(this._peers)
      .reverse()
      .map((key) => {
        const e = this._peers[parseInt(key, 10)];
        let obj = { peerId: key, peerType: e.type, peerName: e.name, renderState: e.broadcastStatus, status: e.status() ? 1 : 0 };
        peerList.push(obj);
      });

    return { type: "UPDATE_PEER_LIST", peerList, msg: "NULL" };
  }

  dataFor(id) {
    // returns the data that should appear for a given ID
    // This is the primary part of peer-list that is extensible

    // NEW (application/json)
    return this.objFormat();
  }
}
exports.default = PeerList;
//# sourceMappingURL=peer-list.js.map
