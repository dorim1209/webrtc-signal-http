"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var SignalEvent;
(function (SignalEvent) {
  SignalEvent["PrePeerAdd"] = "addPeer:pre";
  SignalEvent["PeerAdd"] = "addPeer";
  SignalEvent["PostPeerAdd"] = "addPeer:post";
  SignalEvent["PrePeerRemove"] = "RemovePeer:pre";
  SignalEvent["PeerRemove"] = "RemovePeer";
  SignalEvent["PostPeerRemove"] = "RemovePeer:post";
})((SignalEvent = exports.SignalEvent || (exports.SignalEvent = {})));
function optIsFalsey(opt) {
  return !opt || opt === "false" || (typeof opt === "string" && opt.toLowerCase() === "false");
}
// optIsFalsey(false) == true
// optIsFalsey("false") == true
exports.optIsFalsey = optIsFalsey;
//# sourceMappingURL=utils.js.map
