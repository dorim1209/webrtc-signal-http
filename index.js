#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express = require("express");
const signalRouterCreator = require("./lib");
const heartbeatRouterCreator = require("./lib");
const utils_1 = require("./lib/utils");

const signalSvrPort = config.signalSvrPort;

const app = express();

const heartbeatRouter = heartbeatRouterCreator({
  timeoutPeriod: process.env.WEBRTC_HEARTBEAT_MS || 30 * 1000,
  gcInterval: process.env.WEBRTC_HEARTBEAT_GC_MS || 15 * 1000,
});

const signalRouter = signalRouterCreator({
  peerList: heartbeatRouter.peerList,
  enableCors: !utils_1.optIsFalsey(process.env.WEBRTC_CORS) || true,
  enableLogging: !utils_1.optIsFalsey(process.env.WEBRTC_SIGNAL_LOGGING || true),
});

app.use(signalRouter, heartbeatRouter).listen(process.env.PORT || signalSvrPort);
/* app
  .use(
    lib_1.signalRouterCreator({
      enableCors: !utils_1.optIsFalsey(process.env.WEBRTC_CORS) || true,
      enableLogging: !utils_1.optIsFalsey(process.env.WEBRTC_SIGNAL_LOGGING || true),
    })
  )
  .listen(process.env.PORT || signalSvrPort); */

//# sourceMappingURL=index.js.map
