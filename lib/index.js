"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const bodyParser = require("body-parser");
const cors = require("cors");
const moment = require("moment");
const express = require("express");
const expressBunyan = require("express-bunyan-logger");
const peer_list_1 = require("./peer-list");
const PeerList = peer_list_1.default;
exports.PeerList = PeerList;

const rrModule = require("../../../module/rrModule");
const logModule = require("../../../dist/module/logModule");
const redisModule = require("../../../module/redisModule");
const utilModule = require("../../../dist/module/utilModule");

const config = require("../../../config.json");

const redis = require("async-redis");
const client = redis.createClient();

const geoip = require("geoip-lite");

const regionVersion = config.region_version;
const testVersion = config.test_version;
const mobileXVersion = config.mobiledgeX_version;
const mobileXClientVersion = config.mobiledgeX_client_version;

let router;

let idPeerId = {};
// idPeerId[id] = peerId;

let peerWaitResSent = {};
// peerWaitResSent[peerId] = true;

let peerWaitTime = {};
// peerWaitTime[peerId] = time;

let renderIdPlayerPeerId = {};
// renderIdPlayerPeerId[renderId] = [];

let reconIdRenderId = {};
// reconIdRenderId[reconId] = [];

let isLoggedIn = {};
// isLoggedIn[userId] = true;

let peerIdIdx = 0;

client.flushall().then(() => redisModule.initial(client));

class TimeoutPeerList extends PeerList {
  constructor(existingPeerList, timeoutPeriodMs, gcIntervalMs, sendPeerMessage) {
    super();

    // copy over existing peers if any
    if (existingPeerList) {
      this._peers = existingPeerList._peers || {};
    }

    this._timeoutPeriod = timeoutPeriodMs;

    this._gc = setInterval(() => {
      const stalePeers = this.getPeerIds().filter((id) => {
        return moment().isAfter(this.getPeer(id).timeoutAt);
      });

      stalePeers.forEach((id) => {
        client
          .hget(id, "peerType")
          .then((peerType) => {
            if (peerType == "broadcaster") {
              client.hget(id, "userId").then((userId) => {
                delete isLoggedIn[userId];
                broadcastCancel(userId);
              });
            }

            if (peerType == "render") {
              client.hget(id, "renderId").then((renderId) => {
                rrModule.stopRender(renderId);

                if ((mobileXVersion || mobileXClientVersion) && renderIdPlayerPeerId[renderId]) {
                  let renderIdPlayerPeerIdArr = renderIdPlayerPeerId[renderId];

                  for (let i = 0; i < renderIdPlayerPeerIdArr.length; i++) {
                    client.hset(renderIdPlayerPeerIdArr[i], "renderId", "null");
                  }
                  delete renderIdPlayerPeerId[renderId];
                }

                client.del(id);
                logModule.logger.info(`${id}'s data is removed (TimeoutPeerList)`);
              });
            }

            if ((mobileXVersion || mobileXClientVersion) && peerType == "player") {
              client.hget(id, "renderId").then((renderId) => {
                if (renderId && renderId != "null" && renderIdPlayerPeerId[renderId]) {
                  let renderIdPlayerPeerIdArr = renderIdPlayerPeerId[renderId];
                  const idx = renderIdPlayerPeerIdArr.indexOf(id.toString());

                  if (idx > -1) {
                    if (renderIdPlayerPeerIdArr.length == 1) {
                      delete renderIdPlayerPeerId[renderId];
                      rrModule.stopRender(renderId);
                    } else renderIdPlayerPeerId[renderId].splice(idx, 1);
                  }
                }
              });
            }

            if (peerType == "player" || peerType == "guest") {
              client.del(id);
              logModule.logger.info(`${id}'s data is removed (TimeoutPeerList)`);
            }
          })
          .then(() => {
            this.removePeer(id);
            logModule.logger.info(`${id} is removed (TimeoutPeerList)`);
          });
      });

      if (stalePeers.length != 0) {
        const peerListStr = this.objFormat();
        this.getPeerIds().forEach((id) => {
          sendPeerMessage(id, id, JSON.stringify(peerListStr));
        });
      }
    }, gcIntervalMs);
  }

  cancelGc() {
    clearInterval(this._gc);
  }

  refreshPeerTimeout(id) {
    if (this._peers[id]) {
      this._peers[id].timeoutAt = moment().add(this._timeoutPeriod, "ms");
      return "OK";
    } else {
      return "REMOVED";
    }
  }
}

// abstracted peer message sender logic
// this will direct send if possible, otherwise
// it will buffer into the peerList
// TODO dig into data
const sendPeerMessage = (srcId, destId, data) => {
  // find the current peer

  const peer = router.peerList.getPeer(destId);

  try {
    if (peerWaitResSent[destId] == false) {
      peerWaitResSent[destId] = true;

      logModule.logger.debug(`sendPeerMessage : ${srcId}, ${destId}, ${data}`);

      peer.res.status(200).set("Pragma", srcId.toString()).send(data);
    } else {
      router.peerList.pushPeerData(srcId, destId, data);
    }
  } catch (error) {
    logModule.logger.error(`sendPeerMessage ERR : ${error}`);
  }
};

function signalRouterCreator(opts) {
  router = express.Router();

  // store the peer list on the router
  router.peerList = opts.peerList || new peer_list_1.default();

  // only use logging if configured to do so
  if (opts.enableLogging) {
    router.use(expressBunyan());
  }

  if (opts.enableCors) {
    router.use(cors());
    router.options("*", cors());
  }

  /**
   * @api {post} /register Register HIM
   *
   * @apiVersion 1.0.0
   * @apiName RegisterHIM
   * @apiGroup Service Admin Dashboard
   * @apiDescription Register HIM Information
   *
   * @apiBody {String} id HIM unique ID.
   * @apiBody {String} type It is one of 'both', 'recon', 'render'.
   * @apiBody {String} region In HCM region version, it is to be allocated same region with a broadcaster.
   *
   * @apiSuccess (200) {text} [null] If registered, there will be no text response.
   * @apiSuccess (200) {text} [exist] If it is already registered.
   *
   */
  router.post("/register", bodyParser.text(), bodyParser.urlencoded({ extended: false }), async (req, res) => {
    let data = JSON.parse(req.body);
    let imId = data.id;
    let imType = data.type;
    let imRegion = data.region;

    let isExist = await client.exists(imId);

    if (isExist == 1) {
      res.status(200).send("exist");
    } else {
      await client.hmset(imId, "imType", imType, "imRegion", imRegion);
      res.status(200).end();
    }
  });

  /**
   * @api {post} /update Update HIM
   *
   * @apiVersion 1.0.0
   * @apiName UpdateHIM
   * @apiGroup Service Admin Dashboard
   * @apiDescription Update HIM Information
   *
   * @apiBody {String} id HIM unique ID.
   * @apiBody {String} type It is one of 'both', 'recon', 'render'.
   * @apiBody {String} region HIM region. In HCM region version, it is to be allocated same region with a broadcaster.
   *
   * @apiSuccess (200) {text} [null] If updated, there will be no text response.
   * @apiSuccess (200) {text} [same] The updated information is the same as the information already stored.
   * @apiSuccess (200) {text} [noexist] If there is no information about the ID that to be updated.
   *
   */
  router.post("/update", bodyParser.text(), bodyParser.urlencoded({ extended: false }), async (req, res) => {
    let data = JSON.parse(req.body);
    let imId = data.id;
    let imType = data.type;
    let imRegion = data.region;

    let isExist = await client.exists(imId);

    if (isExist == 1) {
      let imIdData = await client.hgetall(imId);

      if (imIdData.imType == imType && imIdData.imRegion == imRegion) {
        res.status(200).send("same");
      } else {
        await client.hmset(imId, "imType", imType, "imRegion", imRegion);
        res.status(200).end();
      }
    } else {
      res.status(200).send("nonexist");
    }
  });

  /**
   * @api {get} /get_list Get HIM List
   *
   * @apiVersion 1.0.0
   * @apiName GetHIMList
   * @apiGroup Service Admin Dashboard
   * @apiDescription Get registered HIM list
   *
   * @apiSuccess (200) {Object} information Key is ID and values are type and region.
   * @apiSuccessExample {json} Success-Response:
   *     HTTP/1.1 200 OK
   *     {
   *       "id": {
   *               "imType": "both",
   *               "imRegion": "seoul"
   *             }
   *
   *     }
   *
   */
  router.get("/get_list", async (req, res) => {
    let keyArr = await client.keys("*");
    let obj = {};

    for (let i = 0; i < keyArr.length; i++) {
      let key = keyArr[i];

      if (key.length == 32) {
        let keyData = await client.hgetall(key);
        obj[key] = {};
        obj[key].imType = keyData.imType;
        obj[key].imRegion = keyData.imRegion;
      }
    }
    res.status(200).send(JSON.stringify(obj));
  });

  /**
   * @api {get} /sign_in Sign In
   *
   * @apiVersion 1.0.0
   * @apiName SignIn
   * @apiGroup Signaling Peer
   * @apiDescription Peer is signing in
   *
   * @apiQuery {string} peer_type It is one of 'player', 'broadcaster', 'render', 'guest'.
   * @apiQuery {string} peer_name Peer Name.
   * @apiQuery {string} [user_id] This is for player peers and broadcasting peers who need to sign in with thier user IDs.
   * @apiQuery {string} [user_pwd] This is for player peers and broadcasting peers who need to sign in with thier user IDs.
   * @apiQuery {string} [render_id] This is for render peers.
   *
   * @apiSuccess (200) {Object} Peer_List Peer list with peer information except its own peer.
   * @apiSuccessExample {json} Success-Response:
   *     HTTP/1.1 200 OK
   *     {
   *      "type": "UPDATE_PEER_LIST",
   *      "peerList": [{
   *                      "peerId": "1",
   *                      "peerType": "player",
   *                      "peerName": "player1",
   *                      "renderState": "null",
   *                      "status": 1
   *                    }]
   *     }
   *
   */
  router.get("/sign_in", async (req, res) => {
    let peerType = req.query.peer_type;
    let peerName = req.query.peer_name;
    let userId, userPwd; // broadcaster, player
    let reconId, renderId; // render
    let peerId, userPeerId, loginResult;

    logModule.logger.info(`Sign In Remote Address : ${req.ip}`);

    if (!peerName) return res.status(400).end();

    if (!peerType) peerType = "guest";

    if (peerType == "player") {
      userId = req.query.user_id;
      userPwd = req.query.user_pwd;

      if (!userId || !userPwd) return res.status(400).end();

      userPwd = userPwd.toLowerCase();
      peerIdIdx++;
      peerName = peerType + peerIdIdx;
      userId = peerType + peerIdIdx;
      logModule.logger.info(`LOGIN SUCCESS  : ${userId}(${peerType})`);
      peerId = router.peerList.addPeer(peerType, "null", peerName, res, req);
      await client.hmset(peerId, "peerType", peerType, "peerName", peerName, "userId", userId);

      if (mobileXVersion) {
        let geo = geoip.lookup(req.ip.split("::ffff:")[1]);

        if (geo == null) return res.status(400).end();

        logModule.logger.debug(`${userId}'s geo info : ${geo}`);
        let latitude = geo.ll[0];
        let longitude = geo.ll[1];
        await client.hmset(peerId, "peerType", peerType, "peerName", peerName, "userId", userId, "latitude", latitude, "longitude", longitude);
      } else await client.hmset(peerId, "peerType", peerType, "peerName", peerName, "userId", userId);

      idPeerId[userId] = peerId;
    } else if (peerType == "broadcaster") {
      userId = req.query.user_id;
      userPwd = req.query.user_pwd;

      if (!userId || !userPwd) return res.status(400).end();

      userPwd = userPwd.toLowerCase();
      let redisPwd;
      let userRegion;

      if (regionVersion) {
        userRegion = userId.split("_")[0];
        redisPwd = await client.hget("users", userRegion);
      } else {
        if (userId.slice(0, 11) == "broadcaster") redisPwd = await client.hget("users", "broadcaster");
        else redisPwd = await client.hget("users", userId);
      }

      if (redisPwd == userPwd) loginResult = true;

      if (!loginResult) {
        logModule.logger.info(`LOGIN FAIL : ${userId} password is wrong`);
        return res.status(400).end();
      }

      if (isLoggedIn[userId]) {
        logModule.logger.info(`LOGIN FAIL : ${userId} is already logged in`);
        return res.status(400).end();
      }

      isLoggedIn[userId] = true;
      logModule.logger.info(`LOGIN SUCCESS  : ${userId}(${peerType})`);
      peerId = router.peerList.addPeer(peerType, "null", peerName, res, req);
      peerIdIdx++;

      if (mobileXVersion) {
        let geo = geoip.lookup(req.ip.split("::ffff:")[1]);

        if (geo == null) return res.status(400).end();

        let latitude = geo.ll[0];
        let longitude = geo.ll[1];
        await client.hmset(peerId, "peerType", peerType, "peerName", peerName, "userId", userId, "status", "off-air", "latitude", latitude, "longitude", longitude);
      } else if (regionVersion) await client.hmset(peerId, "peerType", peerType, "peerName", peerName, "userId", userId, "status", "off-air", "region", userRegion);
      else await client.hmset(peerId, "peerType", peerType, "peerName", peerName, "userId", userId, "status", "off-air");

      idPeerId[userId] = peerId;
    } else if (peerType == "render") {
      renderId = req.query.render_id;
      userId = await client.hget(renderId, "beingUsedBy");

      if (userId && userId != "null") {
        userPeerId = idPeerId[userId];
        let broadcastStatus = await client.hget(userPeerId, "status");

        if (broadcastStatus == "off-air") broadcastStatus = "preparing";

        if (broadcastStatus == "on-air") broadcastStatus = "start";

        peerId = router.peerList.addPeer(peerType, broadcastStatus, peerName, res, req);
        peerIdIdx++;
        idPeerId[renderId] = peerId;
        reconId = await client.hget(userPeerId, "reconId");
        await client.hmset(peerId, "peerType", peerType, "peerName", peerName, "renderId", renderId, "status", broadcastStatus);
      } else {
        // Self Test Render
        peerId = router.peerList.addPeer(peerType, "start", peerName, res, req);
        peerIdIdx++;
        idPeerId[renderId] = peerId;
        await client.hmset(peerId, "peerType", peerType, "peerName", peerName, "renderId", renderId);
        await client.hset(renderId, "selfTest", "true");
      }
    } else if (peerType == "guest") {
      peerId = router.peerList.addPeer(peerType, "null", peerName, res, req);
      peerIdIdx++;
      await client.hmset(peerId, "peerType", peerType, "peerName", peerName);
    } else {
      logModule.logger.error(`UNDEFINED peerType : ${peerType}`);

      router.peerList.removePeer(peerId);

      logModule.logger.info(`${peerId} is removed`);

      router.peerList.getPeerIds().forEach((id) => {
        sendPeerMessage(id, id, JSON.stringify(router.peerList.dataFor(id)));
      });
      return res.status(400).end();
    }
    logModule.logger.info(`/sign_in : ${peerName}(${peerType})`);
    peerWaitResSent[peerId] = true;

    // send back the list of peers
    res
      .status(200)
      .set("Pragma", peerId.toString())
      .set("Content-Type", "application/json")
      .send(JSON.stringify(router.peerList.dataFor(peerId)));

    // send an updated peer list to all peers
    router.peerList
      .getPeerIds()
      .filter((id) => Number(id) !== peerId)
      .forEach((id) => {
        // updated peer lists must always appear to come from
        // "ourselves", namely the srcId == destId
        sendPeerMessage(id, id, JSON.stringify(router.peerList.dataFor(id)));
      });
  });

  /**
   * @api {get} /broadcast_ready Broadcast Ready
   *
   * @apiVersion 1.0.0
   * @apiName BroadcastReady
   * @apiGroup Signaling Peer
   * @apiDescription (BROADCASTER PEER ONLY) When a broadcaster peer is ready to broadcast, it sends the request.
   *
   * @apiQuery {string} peer_id When a broadcaster signs in, HCM gives the player a peer ID.
   * @apiQuery {string} channel_name Set the channel name when the broadcaster broadcasts.
   * @apiQuery {string} reconDomain (MobiledgeX Client Version ONLY) Recon Instance Domain that a broadcaster intends to use.
   *
   * @apiSuccess (200) {text} [null] If successed, there will be no text response.
   * @apiSuccess (404) {Object} [no_available_resource] There are no resources available to broadcasters.
   * @apiSuccessExample {json} Success-Response:
   *     HTTP/1.1 404 OK
   *     {
   *      "type": "no_available_resource"
   *     }
   *
   */
  router.get("/broadcast_ready", async (req, res) => {
    logModule.logger.info(`/broadcast_ready : ${req.query.peer_id}`);
    let peerId = req.query.peer_id;
    let channelName = req.query.channel_name;
    logModule.logger.debug(`channelName : ${channelName}`);
    const exist = await client.exists(peerId);

    if (exist == 0) {
      logModule.logger.info(`${peerId} was removed`);
      return res.status(400).end();
    }

    if (mobileXClientVersion) {
      let reconDomain = req.query.reconDomain;
      let reconIp = await utilModule.dnsLookup(reconDomain);
      await client.hmset(peerId, "channelName", channelName, "reconIp", reconIp);
    } else await client.hset(peerId, "channelName", channelName);

    let allocateResult = await rrModule.allocateRecon(peerId);
    let reconId = allocateResult.reconId;
    let renderId = allocateResult.renderId;

    if (reconId && renderId) {
      logModule.logger.info(`allocated reconId : ${reconId}, renderId : ${renderId}`);
      await client.hset(reconId, "reconReady", "false");

      if (renderId != "null") await client.hset(renderId, "renderReady", "false");

      await client.hmset(peerId, "reconId", reconId, "renderId", renderId);
      await rrModule.startReconRender(reconId);
      res.status(200).end();
    } else {
      let clientSendData = { type: "no_available_resource" };
      res.status(404).set("Content-Type", "application/json").send(JSON.stringify(clientSendData)).end();
      logModule.logger.info(`{ type: "no_available_resource"}`);
    }
  });

  /**
   * @api {get} /broadcast_start Broadcast Start
   *
   * @apiVersion 1.0.0
   * @apiName BroadcastStart
   * @apiGroup Signaling Peer
   * @apiDescription (BROADCASTER PEER ONLY) When a broadcaster peer starts broadcasting, it sends the request.
   *
   * @apiQuery {string} peer_id When a broadcaster signs in, HCM gives the player a peer ID.
   *
   * @apiSuccess (200) {text} null If successed, there will be no text response.
   *
   */
  router.get("/broadcast_start", async (req, res) => {
    let peerId = req.query.peer_id;
    const exist = await client.exists(peerId);

    if (exist == 0) {
      logModule.logger.info(`${peerId} was removed`);
      return res.status(400).end();
    }

    await client.hset(peerId, "status", "on-air");
    let userId = await client.hget(peerId, "userId");
    logModule.logger.info(`/broadcast_start : ${req.query.peer_id}(${userId})`);

    router.peerList.updatePeer(peerId, "start");

    if (!mobileXVersion && !mobileXClientVersion) {
      let renderId = await client.hget(peerId, "renderId");
      let renderPeerId = idPeerId[renderId];

      try {
        router.peerList.updatePeer(renderPeerId, "start");
      } catch (error) {
        logModule.logger.error(`broadcast_start update peer ERR - ${renderId}(${renderPeerId}) :   ${error}`);
      }

      if (testVersion) {
        let renderIdArr = config.test_render_uuid;

        if (renderIdArr.length > 1) {
          for (let i = 1; i < renderIdArr.length; i++) {
            try {
              router.peerList.updatePeer(idPeerId[renderIdArr[i]], "start");
            } catch (error) {
              logModule.logger.error(`broadcast_start update peer ERR - ${renderIdArr[i]}(${idPeerId[renderIdArr[i]]}) : ${error}`);
            }
          }
        }
      }
    }

    router.peerList.getPeerIds().forEach((id) => {
      sendPeerMessage(id, id, JSON.stringify(router.peerList.dataFor(id)));
    });

    res.status(200).end();
  });

  /**
   * @api {get} /broadcast_cancel Broadcast Cancel
   *
   * @apiVersion 1.0.0
   * @apiName BroadcastCancel
   * @apiGroup Signaling Peer
   * @apiDescription (BROADCASTER PEER ONLY) When a broadcaster peer ends the broadcast, it sends the request.
   *
   * @apiQuery {string} peer_id When a broadcaster signs in, HCM gives the player a peer ID.
   *
   * @apiSuccess (200) {text} null If successed, there will be no text response.
   *
   */
  router.get("/broadcast_cancel", async (req, res) => {
    logModule.logger.info(`/broadcast_cancel : ${req.query.peer_id}`);
    let peerId = req.query.peer_id;
    const exist = await client.exists(peerId);

    if (exist == 0) {
      logModule.logger.info(`${peerId} was removed`);
      return res.status(400).end();
    }

    let userId = await client.hget(peerId, "userId");

    await broadcastCancel(userId);

    router.peerList.getPeerIds().forEach((id) => {
      sendPeerMessage(id, id, JSON.stringify(router.peerList.dataFor(id)));
    });

    res.status(200).end();
  });

  /**
   * @api {get} /broadcast_stop Broadcast Stop
   *
   * @apiVersion 1.0.0
   * @apiName BroadcastStop
   * @apiGroup Signaling Peer
   * @apiDescription (BROADCASTER PEER ONLY) When a broadcaster peer pauses the broadcast, it sends the request.
   *
   * @apiQuery {string} peer_id  When a broadcaster signs in, HCM gives the player a peer ID.
   *
   * @apiSuccess (200) {text} null If successed, there will be no text response.
   *
   */
  router.get("/broadcast_stop", async (req, res) => {
    logModule.logger.info(`/broadcast_stop : ${req.query.peer_id}`);
    // 방송 일시정지 broadcaster와 recon 연결 되어있지만 data는 가지 않는 상태
    let peerId = req.query.peer_id;
    const exist = await client.exists(peerId);

    if (exist == 0) {
      logModule.logger.info(`${peerId} was removed`);
      return res.status(400).end();
    }

    await client.hset(peerId, "status", "pausing");
    router.peerList.updatePeer(peerId, "pausing");

    if (!mobileXVersion && !mobileXClientVersion) {
      let renderId = await client.hget(peerId, "renderId");
      let renderPeerId = idPeerId[renderId];

      try {
        router.peerList.updatePeer(renderPeerId, "pausing");
      } catch (error) {
        logModule.logger.error(`broadcast_stop update peer ERR - ${renderId}(${renderPeerId}) : ${error}`);
      }
    }

    router.peerList.getPeerIds().forEach((id) => {
      sendPeerMessage(id, id, JSON.stringify(router.peerList.dataFor(id)));
    });

    res.status(200).end();
  });

  /**
   * @api {get} /get_renderid Get Render ID
   *
   * @apiVersion 1.0.0
   * @apiName GetRenderID
   * @apiGroup MobiledgeX
   * @apiDescription (PLAYER PEER ONLY) If a player peer selects a broadcaster peer from the channel list, HCM finds the allocated render peer of the brodcaster.
   *
   * @apiQuery {string} peer_id  When a player signs in, HCM gives the player a peer ID.
   * @apiQuery {string} to Peer ID of the selected broadcaster.
   * @apiQuery {string} renderDomain (MobiledgeX Client Version ONLY) Render Instance Domain that a player intends to use.
   *
   * @apiSuccess (200) {Object} renderPeerID Peer ID of the allocated render peer of the selected broadcaster.
   * @apiSuccessExample {json} Success-Response:
   *     HTTP/1.1 200 OK
   *     {
   *       "renderPeerId": "render peer ID (If there is no render peer, it is 'undefined')"
   *     }
   *
   */
  router.get("/get_renderid", async (req, res) => {
    let peerId = req.query.peer_id;
    const exist = await client.exists(peerId);

    if (exist == 0) {
      logModule.logger.info(`${peerId} was removed`);
      return res.status(400).end();
    }

    if (mobileXClientVersion) {
      let renderDomain = req.query.renderDomain;
      let renderIp = await utilModule.dnsLookup(renderDomain);
      await client.hset(peerId, "renderIp", renderIp);
    }

    let toPeerId = req.query.to;
    logModule.logger.info(`/get_renderid : ${peerId} -> ${toPeerId}`);
    let allocateResult = await rrModule.allocateRender(peerId, toPeerId);
    let renderId = "null";

    if (allocateResult.msg == "starting") {
      let reconId = allocateResult.reconId;
      renderId = allocateResult.renderId;
      renderIdPlayerPeerId[renderId] = [peerId];
      logModule.logger.debug(`allocateResult.msg == "starting" renderIdPlayerPeerId[${renderId}] : ${renderIdPlayerPeerId[renderId]}`);
      rrModule.startRender(renderId);

      if (!reconIdRenderId[reconId]) reconIdRenderId[reconId] = [];

      reconIdRenderId[reconId].push(renderId);
    } else if (allocateResult.msg == "started") {
      renderId = allocateResult.renderId;
      renderIdPlayerPeerId[renderId].push(peerId);
      logModule.logger.debug(`allocateResult.msg == "started" renderIdPlayerPeerId[${renderId}] : ${renderIdPlayerPeerId[renderId]}`);
    }

    if (renderId && renderId != "null") {
      let idx = 0;
      await client.hset(peerId, "renderId", renderId);

      const interval = setInterval(function findRenderPeerId() {
        let renderPeerId = idPeerId[renderId];
        idx++;

        if (renderPeerId) {
          clearInterval(interval);
          let clientSendData = { renderPeerId };
          res.status(200).set("Content-Type", "application/json").send(JSON.stringify(clientSendData)).end();
        } else if (idx == 10) {
          clearInterval(interval);
          let clientSendData = { type: "no_available_resource" };
          res.status(404).set("Content-Type", "application/json").send(JSON.stringify(clientSendData)).end();
          logModule.logger.info(`{ type: "no_available_resource"}`);
        }
      }, 1000);
    } else {
      let clientSendData = { type: "no_available_resource" };
      res.status(404).set("Content-Type", "application/json").send(JSON.stringify(clientSendData)).end();
      logModule.logger.info(`{ type: "no_available_resource"}`);
    }
  });

  /**
   * @api {post} /message Message
   *
   * @apiVersion 1.0.0
   * @apiName Message
   * @apiGroup Signaling Peer
   * @apiDescription When a peer wants to send a message to another peer, it sends the request.
   *
   * @apiQuery {string} peer_id When a peer signs in, HCM gives the peer a peer ID.
   * @apiQuery {string} to Peer ID to receive messages.
   *
   * @apiBody {String} [BYE] When a peer wants to disconnect with connected peer.
   * @apiBody {Object} [offer] When the key of request's body is offer, it means a peer is trying to connect to another peer.
   * @apiBody {Object} [data] The data that a peer wants to send.
   *
   * @apiSuccess (200) {text} [null] If it sends a data, there will be no text response.
   *
   */
  router.post("/message", bodyParser.text(), bodyParser.urlencoded({ extended: false }), async (req, res) => {
    let peerId = req.query.peer_id;
    let toPeerId = req.query.to;

    if (!peerId || !toPeerId) {
      return res.status(400).end();
    }

    // find the current peer
    const toPeer = router.peerList.getPeer(toPeerId);

    if (!toPeer) {
      return res.status(404).end();
    }

    let peerIdData = await client.hgetall(peerId);

    if (!peerIdData) {
      logModule.logger.info(`${peerId} was removed`);
      return res.status(400).end();
    }

    let toPeerIdData = await client.hgetall(toPeerId);

    if (!peerIdData) {
      logModule.logger.info(`${toPeerId} was removed`);
      return res.status(400).end();
    }

    let peerType = peerIdData.peerType;
    let toPeerType = toPeerIdData.peerType;
    let data = req.body;
    logModule.logger.debug(`/message : ${peerId} (${peerType})-> ${toPeerId}`);

    if (peerType == "guest" || peerType == "player") {
      if (toPeerType == "render") {
        let peerName = peerIdData.peerName;
        let renderId = toPeerIdData.renderId;

        if (data == "BYE") {
          logModule.logger.info(`${peerName} (${peerType}${peerId}) disconnects from ${renderId}`);

          if ((mobileXVersion || mobileXClientVersion) && renderIdPlayerPeerId[renderId]) {
            let renderIdPlayerPeerIdArr = renderIdPlayerPeerId[renderId];
            const idx = renderIdPlayerPeerIdArr.indexOf(peerId);

            if (idx > -1) {
              if (renderIdPlayerPeerIdArr.length == 1) {
                delete renderIdPlayerPeerId[renderId];
                logModule.logger.debug(`renderIdPlayerPeerId[${renderId}] is deleted`);
                rrModule.stopRender(renderId);
              } else {
                renderIdPlayerPeerId[renderId].splice(idx, 1);
                logModule.logger.debug(`renderIdPlayerPeerId[${renderId}] : ${renderIdPlayerPeerId[renderId]}`);
              }
            }

            await client.hset(peerId, "renderId", "null");
          }
        } else {
          let bodyObj = JSON.parse(data);

          if (bodyObj.type == "offer") logModule.logger.info(`${peerName} (${peerType}${peerId}) connects to ${renderId}`);
        }
      }
    }

    if (peerType == "render") {
      if (toPeerType == "guest" || toPeerType == "player") {
        let renderId = peerIdData.renderId;
        let peerName = toPeerIdData.peerName;

        if (data == "BYE") {
          logModule.logger.info(`${peerName} (${peerType}${peerId}) disconnects from ${renderId}`);

          if ((mobileXVersion || mobileXClientVersion) && renderIdPlayerPeerId[renderId]) {
            let renderIdPlayerPeerIdArr = renderIdPlayerPeerId[renderId];
            const idx = renderIdPlayerPeerIdArr.indexOf(toPeerId);

            if (idx > -1) {
              if (renderIdPlayerPeerIdArr.length == 1) {
                delete renderIdPlayerPeerId[renderId];
                logModule.logger.debug(`renderIdPlayerPeerId[${renderId}] is deleted`);
                rrModule.stopRender(renderId);
              } else {
                renderIdPlayerPeerId[renderId].splice(idx, 1);
                logModule.logger.debug(`renderIdPlayerPeerId[${renderId}] : ${renderIdPlayerPeerId[renderId]}`);
              }
            }

            await client.hset(peerId, "renderId", "null");
          }
        } else {
          let bodyObj = JSON.parse(data);

          if (bodyObj.type == "offer") logModule.logger.info(`${peerName} (${peerType}${peerId}) connects to ${renderId}`);
        }
      }
    }

    // send data to the peer
    // (this will write to the `to` socket, or buffer if needed)
    sendPeerMessage(peerId, toPeerId, data);
    // whether we send directly or buffer we tell the sender everything is 'OK'
    res.status(200).end();
  });

  /**
   * @api {get} /wait Wait
   *
   * @apiVersion 1.0.0
   * @apiName Wait
   * @apiGroup Signaling Peer
   * @apiDescription A peer is waiting for receiving a message. If there is a message to receive, it is sent with the response.
   *
   * @apiQuery {string} peer_id Peer ID. When a peer signs in, HCM gives the peer a peer ID.
   *
   * @apiSuccess (200) {Object} The data sent from another peer.
   *
   */
  router.get("/wait", async (req, res) => {
    let peerId = req.query.peer_id;
    const exist = await client.exists(peerId);

    if (exist == 0) {
      logModule.logger.info(`${peerId} was removed`);
      return res.status(400).end();
    }

    const pop = router.peerList.shiftPeerData(peerId);

    peerWaitResSent[peerId] = false;
    peerWaitTime[peerId] = Date.now();

    // if we have data to send, just send it now
    if (pop) {
      peerWaitResSent[peerId] = true;
      res.status(200).set("Pragma", pop.srcId.toString()).send(pop.data);
    } else {
      // set the socket for the given peer and let it hang
      // this is the critical piece that let's us send data
      // using 'push'-ish technology
      router.peerList.setPeerSocket(peerId, res, req);
    }
  });

  /**
   * @api {get} /sign_out Sign Out
   *
   * @apiVersion 1.0.0
   * @apiName SignOut
   * @apiGroup Signaling Peer
   * @apiDescription Peer is sigining out
   *
   * @apiQuery {string} peer_id Peer ID. When a peer signs in, HCM gives the peer a peer ID.
   *
   * @apiSuccess (200) {text} null If successed, there will be no text response.
   *
   */
  router.get("/sign_out", async (req, res) => {
    let peerId = req.query.peer_id;
    logModule.logger.info(`/sign_out : ${peerId}`);
    const exist = await client.exists(peerId);

    if (exist == 0) {
      logModule.logger.info(`${peerId} was removed`);
      return res.status(400).end();
    }

    try {
      let peerIdData = await client.hgetall(peerId);
      let peerType = peerIdData.peerType;

      if (peerType == "broadcaster" || peerType == "player") {
        let userId = peerIdData.userId;

        if (peerType == "broadcaster") {
          await broadcastCancel(userId);
          delete isLoggedIn[userId];
        }

        if ((mobileXVersion || mobileXClientVersion) && peerType == "player") {
          let renderId = await client.hget(id, "renderId");

          if (renderId && renderId != "null" && renderIdPlayerPeerId[renderId]) {
            let renderIdPlayerPeerIdArr = renderIdPlayerPeerId[renderId];
            const idx = renderIdPlayerPeerIdArr.indexOf(peerId);

            if (idx > -1) {
              if (renderIdPlayerPeerIdArr.length == 1) {
                delete renderIdPlayerPeerId[renderId];
                logModule.logger.debug(`renderIdPlayerPeerId[${renderId}] is deleted`);
                rrModule.stopRender(renderId);
              } else {
                renderIdPlayerPeerId[renderId].splice(idx, 1);
                logModule.logger.debug(`renderIdPlayerPeerId[${renderId}] : ${renderIdPlayerPeerId[renderId]}`);
              }
            }
          }
        }

        if ((mobileXVersion || mobileXClientVersion) && peerType == "render") {
          let renderId = await client.hget(peerId, "renderId");
          if (renderIdPlayerPeerId[renderId]) {
            let renderIdPlayerPeerIdArr = renderIdPlayerPeerId[renderId];

            for (let i = 0; i < renderIdPlayerPeerIdArr.length; i++) {
              await client.hset(renderIdPlayerPeerIdArr[i], "renderId", "null");
            }
            delete renderIdPlayerPeerId[renderId];
            logModule.logger.debug(`renderIdPlayerPeerId[${renderId}] is deleted`);
          }
        }

        logModule.logger.info(`LOGOUT SUCCESS  : ${userId}`);
      }

      // remove the peer
      router.peerList.removePeer(peerId);

      // send an updated peer list to all peers
      router.peerList.getPeerIds().forEach((id) => {
        // updated peer lists must always appear to come from
        // "ourselves", namely the srcId == destId
        sendPeerMessage(id, id, JSON.stringify(router.peerList.dataFor(id)));
      });

      await client.del(peerId);
      logModule.logger.info(`${peerId} and data are removed (sign_out)`);
    } catch (error) {
      logModule.logger.error(`sign_out update peer ERR : ${error}`);
    }

    res.status(200).end();
  });

  const heartbeatPeerList = (opts.peerList = new TimeoutPeerList(opts.peerList || null, opts.timeoutPeriod || 6000, opts.gcInterval || 3000, sendPeerMessage));

  // store the peer list on the router
  router.peerList = heartbeatPeerList;

  /**
   * @api {get} /heartbeat Heartbeat
   *
   * @apiVersion 1.0.0
   * @apiName Heartbeat
   * @apiGroup Signaling Peer
   * @apiDescription Peers are signalling that they are still alive. In the case of a broadcast peer, it can get allocated resource information along with a response to this request.
   *
   * @apiQuery {string} peer_id Peer ID. When a peer signs in, HCM gives the peer a peer ID.
   *
   * @apiSuccess (200) {text} [null] If successed, there will be no text response.
   * @apiSuccess (200) {Object} [server_information] It is for a broadcaster peer. When allocated resources are ready, a broadcaster peer can get allocated resource information along with a response to this request.
   * @apiSuccessExample {json} Success-Response:
   *     HTTP/1.1 200 OK
   *     {
   *       "type": "server_info",
   *       "recon_info": {
   *                      "ip": "reconIp",
   *                      "port": "broadcasterPort"
   *                     },
   *       "audio_info": {
   *                      "ip": "renderIp",
   *                      "port": "audioListenPort"
   *                     }
   *     }
   *
   */
  router.get("/heartbeat", async (req, res) => {
    let peerId = req.query.peer_id;
    let peerIdData = await client.hgetall(peerId);

    let clientSendData;

    if (!peerIdData) {
      logModule.logger.info(`HEARTBEAT 400 : ${peerId}'s data is deleted`);
      return res.status(400).end();
    }

    let peerType = peerIdData.peerType;

    if (peerType == "broadcaster") {
      let reconId = peerIdData.reconId;
      let renderId = peerIdData.renderId;
      let status = peerIdData.status;
      let reconReady, renderReady, readyTime;
      let reconIdData, renderIdData;

      if (reconId && reconId != "null") {
        reconIdData = await client.hgetall(reconId);
        reconReady = reconIdData.reconReady;
      }

      if (renderId && renderId != "null") {
        renderIdData = await client.hgetall(renderId);
        renderReady = renderIdData.renderReady;
      }

      if (mobileXVersion || mobileXClientVersion) {
        if (reconId && status == "off-air" && reconReady == "true") {
          readyTime = Date.now();
          await client.hmset(peerId, "status", "preparing", "readyTime", readyTime);

          let reconIp = reconIdData.reconIp;
          let broadcasterPort = reconIdData.broadcasterPort;

          clientSendData = { type: "server_info", recon_info: { ip: reconIp, port: broadcasterPort }, audio_info: { ip: "127.0.0.1", port: "20036" } };

          logModule.logger.info(`{ type: "server_info", recon_info : { ip: ${reconIp}, port: ${broadcasterPort} }, audio_info : { ip: 127.0.0.1, port: 20036 } }`);
        }
      } else {
        if (reconId && renderId && status == "off-air" && reconReady == "true" && renderReady == "true") {
          readyTime = Date.now();
          await client.hmset(peerId, "status", "preparing", "readyTime", readyTime);

          let reconIp = reconIdData.reconIp;
          let broadcasterPort = reconIdData.broadcasterPort;
          let renderIp = renderIdData.renderIp;
          let audioListenPort = renderIdData.audioListenPort;

          clientSendData = { type: "server_info", recon_info: { ip: reconIp, port: broadcasterPort }, audio_info: { ip: renderIp, port: audioListenPort } };

          logModule.logger.info(`{ type: "server_info", recon_info : { ip: ${reconIp}, port: ${broadcasterPort} }, audio_info : { ip: ${reconIp}, port: ${audioListenPort} } }`);
        }
      }
    }

    let refreshResult = heartbeatPeerList.refreshPeerTimeout(peerId);

    if (refreshResult == "REMOVED") {
      logModule.logger.info(`HEARTBEAT 400 : ${peerId}'s refresh result is REMOVED`);
      res.status(400).end();
    } else if (clientSendData) res.status(200).send(JSON.stringify(clientSendData)).end();
    else res.status(200).end();
  });

  return router;
}
exports.signalRouterCreator = signalRouterCreator;
//# sourceMappingURL=index.js.map

async function checkReconBroadcastStatus(reconId) {
  let userId = await client.hget(reconId, "beingUsedBy");

  if (userId && userId != "null") {
    await broadcastCancel(userId);

    router.peerList.getPeerIds().forEach((id) => {
      sendPeerMessage(id, id, JSON.stringify(router.peerList.dataFor(id)));
    });
  }
}
module.exports.checkReconBroadcastStatus = checkReconBroadcastStatus;

async function checkRenderRestart(renderId) {
  let renderPeerId = idPeerId[renderId];
  let userId = await client.hget(renderId, "beingUsedBy");
  logModule.logger.info(`checkRenderRestart : ${renderId}`);

  router.peerList.removePeer(renderPeerId);
  await client.del(renderPeerId);

  logModule.logger.info(`${renderPeerId} and data are removed (checkRenderRestart)`);

  router.peerList.getPeerIds().forEach((id) => {
    sendPeerMessage(id, id, JSON.stringify(router.peerList.dataFor(id)));
  });

  if (mobileXVersion || mobileXClientVersion) {
    if (!renderIdPlayerPeerId[renderId] || renderIdPlayerPeerId[renderId].length == 0) return false;
    logModule.logger.debug(`renderIdPlayerPeerId[${renderId}] : ${renderIdPlayerPeerId[renderId]}`);

    if (userId && userId != "null") {
      let userPeerId = idPeerId[userId];
      let broadcastStatus = await client.hget(userPeerId, "status");
      logModule.logger.info(`checkRenderRestart : ${userId}(${userPeerId}) - ${broadcastStatus}`);

      if (broadcastStatus && broadcastStatus != "off-air") return true;
    }
  } else {
    if (userId && userId != "null") {
      let userPeerId = idPeerId[userId];
      let broadcastStatus = await client.hget(userPeerId, "status");
      logModule.logger.info(`checkRenderRestart : ${userId}(${userPeerId}) - ${broadcastStatus}`);

      if (broadcastStatus && broadcastStatus != "off-air") return true;
    }
  }
  return false;
}
module.exports.checkRenderRestart = checkRenderRestart;

async function broadcastCancel(userId) {
  let peerId = idPeerId[userId];
  let peerIdData = await client.hgetall(peerId);
  logModule.logger.info(`broadcastCancel - ${userId}(${peerId})`);

  if (peerIdData) {
    let reconId = peerIdData.reconId;
    let renderId = peerIdData.renderId;
    logModule.logger.debug(`reconId : ${reconId}, renderId : ${renderId}`);

    if (mobileXVersion || mobileXClientVersion) {
      if (reconId && reconId != "null") {
        let renderIdArr = reconIdRenderId[reconId];

        if (renderIdArr && renderIdArr.length != 0) {
          for (let i = 0; i < renderIdArr.length; i++) {
            let renderId = renderIdArr[i];
            let renderPeerId = idPeerId[renderId];
            router.peerList.removePeer(renderPeerId);
            await client.del(renderPeerId);
            logModule.logger.info(`${renderPeerId} and data are removed (broadcastCancel)`);
            rrModule.stopRender(renderId);
          }
          delete reconIdRenderId[reconId];
        }
        rrModule.stopRecon(reconId);
        await client.hmset(peerId, "reconId", "null", "renderId", "null", "status", "off-air");
      }
    } else {
      if (reconId && reconId != "null" && renderId && renderId != "null") {
        let renderPeerId = idPeerId[renderId];
        router.peerList.removePeer(renderPeerId);
        await client.del(renderPeerId);
        logModule.logger.info(`${renderPeerId} and data are removed (broadcastCancel)`);
        await client.hmset(peerId, "reconId", "null", "renderId", "null", "status", "off-air");
        rrModule.stopRecon(reconId);
        rrModule.stopRender(renderId);

        if (testVersion) {
          let renderIdArr = config.test_render_uuid;

          if (renderIdArr.length > 1) {
            for (let i = 1; i < renderIdArr.length; i++) {
              let testRenderId;
              try {
                testRenderId = renderIdArr[i];
                router.peerList.removePeer(testRenderId);
                await client.del(testRenderId);
                logModule.logger.info(`${testRenderId} is removed (broadcastCancel)`);
                rrModule.stopRender(testRenderId);
              } catch (error) {
                logModule.logger.error(`broadcastCancel update peer ERR - ${testRenderId} : ${error}`);
              }
            }
          }
        }
      }
    }

    try {
      router.peerList.updatePeer(peerId, "off-air");
    } catch (error) {
      logModule.logger.error(`broadcastCancel update peer ERR - ${peerId} : ${error}`);
    } finally {
      if (!isLoggedIn[userId]) {
        await client.del(peerId);
        logModule.logger.info(`${peerId}'s data is removed (broadcastCancel)`);
      }
    }
  }
}
module.exports.broadcastCancel = broadcastCancel;

function checkWaitTime() {
  router.peerList.getPeerIds().forEach((id) => {
    let currentTime = Date.now();
    // wait를 보낸지 45sec가 넘은 peer id를 찾음
    if (peerWaitTime[id] && currentTime - peerWaitTime[id] > 45000) {
      // 현재 peer list를 다시 보냄
      sendPeerMessage(id, id, JSON.stringify(router.peerList.dataFor(id)));
    }
  });
}

// 10 sec 마다 wait time을 check
setInterval(checkWaitTime, 10000);
