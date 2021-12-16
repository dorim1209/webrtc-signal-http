# webrtc-signal-http

[![Build Status](https://travis-ci.org/bengreenier/webrtc-signal-http.svg?branch=master)](https://travis-ci.org/bengreenier/webrtc-signal-http)

[![Deploy to Azure](https://azuredeploy.net/deploybutton.png)](https://azuredeploy.net/) [![Greenkeeper badge](https://badges.greenkeeper.io/bengreenier/webrtc-signal-http.svg)](https://greenkeeper.io/)

opinionated webrtc signal provider using `http` as a protocol :spider_web: :signal_strength:

![logo gif](./readme_example.gif)

We needed a simple to use, easy to extend [WebRTC](https://webrtc.org/) signaling server that communicated over regular old `HTTP/1.1` for [3DStreamingToolkit](https://github.com/3dstreamingtoolkit) - this is it. It's designed to mirror [the WebRTC example server](https://github.com/svn2github/webrtc/tree/master/talk/examples/peerconnection/server) at an API level, while allowing developers to consume and extend the base functionality.

## Getting started

> Learn about the [RESTful API](#restful-api) via the OpenAPI doc ([raw](./swagger.yml) or [hosted](https://rebilly.github.io/ReDoc/?url=https://raw.githubusercontent.com/bengreenier/webrtc-signal-http/master/swagger.yml)) to understand how clients should interact with the service.

To install the server cli `npm install -g webrtc-signal-http`. To run it, just use `webrtc-signal-http` from the command line, using the `PORT` environment variable to configure it's listening port.

To run locally run `npm run build` and `npm run start`

To consume this server as a basis but add some extended functionality, `npm install webrtc-signal-http` and then run some code like the following:

```
const express = require('express')
const signalRouterCreator = require('webrtc-signal-http')

const app = express()
const router = signalRouterCreator({
    enableLogging: true
})

app.use(router)
app.get('/new-endpoint', (req, res) => { res.send('hello') })

app.listen(process.env.PORT || 3000)
```

## RESTful API

For example clients, see the following:
+ [webrtc-native-peerconnection](https://github.com/svn2github/webrtc/tree/master/talk/examples/peerconnection/client)

### GET /sign_in

> Takes `peer_name` query parameter

Indicates a peer is available to peer with. The response will contain the unique peer_id assigned to the caller in the `Pragma` header, and a `csv` formatted list of peers in the `body`.

```
GET http://localhost:3000/sign_in?peer_name=test HTTP/1.1
Host: localhost:3000

=>

HTTP/1.1 200 OK
Pragma: 1
Content-Type: text/plain; charset=utf-8
Content-Length: 8

test,1,1
```

### GET /sign_out

> Takes `peer_id` query parameter

Indicates a peer is no longer available to peer with. It is expected this method be called when a peer is no longer intending to use signaling. The response will be empty.

```
GET http://localhost:3000/sign_out?peer_id=1 HTTP/1.1
Host: localhost:3000

=>

HTTP/1.1 200 OK
Content-Length: 0
```

### POST /message

> Takes `peer_id` (indicating the caller id) and `to` (indicating whom we're sending to)

Provides a messaging mechanism for one peer to send data to another. There are no requirements around the type of data that can be sent. The message may be buffered until the receiving peer connects to the service. The response will be empty.

```
POST http://localhost:3000/message?peer_id=2&to=3 HTTP/1.1
Host: localhost:3000
Content-Type: text/plain
Content-Length: 12

test content

=>

HTTP/1.1 200 OK
Content-Length: 0
```

### GET /wait

> Takes `peer_id` query parameter

Provides a mechanism for simulated server push, using vanilla http long polling. That is, the TCP socket behind this request will remain open to the server until there is content the server needs to send. In the event of a TCP timeout the client should reconnect. Messages that contain a `Pragma` value that matches the client `peer_id` are peer status updates and should be handled the same as the status update provided in the `GET /sign_in` response. `Content-Type` headers will not reflect the type of the original content.

Peer status update:

```
GET http://localhost:3000/wait?peer_id=2 HTTP/1.1
Host: localhost:3000

=>

HTTP/1.1 200 OK
Pragma: 2
Content-Type: text/html; charset=utf-8
Content-Length: 18

test2,3,1
test,2,0
```

Peer message:

```
GET http://localhost:3000/wait?peer_id=2 HTTP/1.1
Host: localhost:3000

=>

HTTP/1.1 200 OK
Pragma: 3
Content-Type: text/html; charset=utf-8
Content-Length: 12

test content
```

## Extension API

For example extensions, see the following:
+ [webrtc-signal-http-heartbeat](https://github.com/bengreenier/webrtc-signal-http-heartbeat)

### module.exports

> This is the exported behavior, you access it with `require('webrtc-signal-http)`

[Function] - takes a [SignalOpts](#signalopts) indicating if the bunyan logger should be enabled. __Returns__ an [express](https://expressjs.com) `router` object.

#### router.peerList

[Object] - can be used to retrieve a `PeerList` from the express `router`. __Returns__ a [PeerList](#peerlist) object.

### PeerList

[Class] - Represents a collection of WebRTC peers on which signaling operations are possible.

#### events

These events will be emitted from the instance, and can be caught with `on`, `once`, `off`, etc. For more information, see [EventEmitter](https://nodejs.org/api/events.html#events_class_eventemitter).

##### addPeer:pre

Fired just before a peer is added, with the argument `name` - it indicates the peer name.

##### addPeer

Fired when a peer is being added, with the argument `peer` - it is the fully formed peer object.

##### addPeer:post

Fired after a peer is added, with the argument `peer` - it is the fully formed peer object that has been inserted into the peer list.


##### removePeer:pre

Fired just before a peer is removed, with the argument `id` - it indicates the peer id.

##### removePeer

Fired when a peer is being removed, with the argument `peer` - it is the fully formed peer object.

##### removePeer:post

Fired after a peer is removed, with the argument `peer` - it is the fully formed peer object that has been removed from the peer list.

#### addPeer

[Function] - takes `name` (a string), `res` (a http.Response object), and `req` (a http.Request object). Creates a representation of the peer for signaling. __Returns__ a `Number` that shall be used as a unique id for the peer.

#### removePeer

[Function] - takes `id` (a Number). Removes the representation of the peer from signaling. __Returns__ nothing.

#### getPeer

[Function] - takes `id` (a Number). Retrieves the representation of the peer from signaling. __Returns__ a [Peer](#peer) object.

#### getPeerIds

[Function] - takes nothing. Retrieves all the peer id's in the PeerList. __Returns__ an [Array] of id's (Numbers).

#### setPeerSocket

[Function] - takes `id` (a Number), `res` (a http.Response object), and `res` (a http.Request object). Updates a representation of the peer with a new response object for signaling. __Returns__ nothing.

#### pushPeerData

[Function] - takes `srcId` (a Number), `destId` (a Number), `data` (an Object). Pushs arbitrary data onto a stack for a particular destination peer. __Returns__ nothing.

#### popPeerData

[Function] - takes `id` (a Number). Retrives arbitrary data from the stack for the particular peer. __Returns__ a [PeerData](#peerdata) object.

#### format

[Function] - takes nothing. Formats a csv (without headers) list of the peers in the format of `peerName, peerId, peerConnectionStatusAsInt`. It's worth noting that `peerConnectionStatusAsInt` is a `0` or `1` literal that represents if the peer is currently connected to the server. __Returns__ a `string`.

### PeerData

[Object] - Represents arbitrary data to be sent to a peer on behalf of another peer.

#### srcId

[Number] - the peer id that sent the data (as defined when `pushPeerData` was called).

#### data

[Object] - the peer data to be sent (as defined when `pushPeerData` was called).

### Peer

[Object] - Represents a peer for signaling. Contains both interally used data properties as well as externally exposed data properties.

#### name

[String] - the name of the peer.

#### id

[Number] - the unique id of the peer.

#### buffer

[Array] - an internally used stack that stores arbitrary data (see `pushPeerData` and `popPeerData`).

#### res

[http.Response] - the response object of the peer. Used to send 'push' data to a hanging socket.

#### status

[Function] - takes nothing. Determines if the peer's `res` is able to be written to. __Returns__ a `bool`.

### SignalOpts

[Object] - represents the options that can be given to the signal creator

#### enableLogging

[Bool] - enables logging (default `true`)

#### enableCors

[Bool] - enables Cross Origin Resource Sharing (default `true`)

#### peerList

[PeerList](#peerlist) - uses a given peerList implementation instead of creating one

## License

MIT

# webrtc-signal-http-heartbeat

[![Build Status](https://travis-ci.org/bengreenier/webrtc-signal-http-heartbeat.svg?branch=master)](https://travis-ci.org/bengreenier/webrtc-signal-http-heartbeat)

[![Deploy to Azure](https://azuredeploy.net/deploybutton.png)](https://azuredeploy.net/)

[webrtc-signal-http](https://github.com/bengreenier/webrtc-signal-http) heartbeat timeout extension :heart: :timer_clock:

![logo gif](./readme_example_heartbeat.gif)

This adds an additional signal message to help prevent stale peers appearing as legitimate, by requiring clients to send this message at a defined interval. Clients that stop sending the message are removed from the [PeerList](https://github.com/bengreenier/webrtc-signal-http#peerlist).

## Getting started

> Learn about the [RESTful API extension](#restful-api) via the OpenAPI doc ([raw](./swagger.yml) or [hosted](https://rebilly.github.io/ReDoc/?url=https://raw.githubusercontent.com/bengreenier/webrtc-signal-http-heartbeat/master/swagger.yml)) to understand how clients should change their interaction with the service when using this extension.

To install a signal server including this extension that can be used in a cli `npm install -g webrtc-signal-http-signal`. To run it, just use `webrtc-signal-http-heartbeat` from the command line, using the `PORT` environment variable to configure it's listening port, `WEBRTC_HEARTBEAT_MS` to configure the heartbeat timeout, and `WEBRTC_HEARTBEAT_GC_MS` to configure the gc interval.

To consume this server in combination with [webrtc-signal-http](https://github.com/bengreenier/webrtc-signal-http) and other possible extensions, `npm install webrtc-signal-http webrtc-signal-http-heartbeat` and then run some code like the following:

```
const express = require('express')
const signalRouterCreator = require('webrtc-signal-http')
const heartbeatRouterCreator = require('webrtc-signal-http-heartbeat')

const app = express()
const heartbeatRouter = heartbeatRouterCreator()
const signalRouter = signalRouterCreator({
    peerList: heartbeatRouter.peerList
})

app.use(signalRouter, heartbeatRouter)

app.get('/new-endpoint', (req, res) => { res.send('hello') })

app.listen(process.env.PORT || 3000)
```

## RESTful API

To understand the base API provided by [webrtc-signal-http](https://github.com/bengreenier/webrtc-signal-http), look at the [docs for that project](https://github.com/bengreenier/webrtc-signal-http#restful-api). This documents the API endpoints this extension adds. :sparkles:

### GET /heartbeat

> Takes `peer_id` query parameter

Indicates a peer is still actively connected and able to signal. This endpoint is expected to be called at an interval defined by the extension (default `30s`). The response will be empty.

```
GET http://localhost:3000/heartbeat?peer_id=1 HTTP/1.1
Host: localhost:3000

=>

HTTP/1.1 200 OK
Content-Length: 0
```

## Extension API

To understand the base API provided by [webrtc-signal-http](https://github.com/bengreenier/webrtc-signal-http), look at the [docs for that project](https://github.com/bengreenier/webrtc-signal-http#extension-api). This documents the javascript API this extension adds. :sparkles:

### module.exports

> This is the exported behavior, you access it with `require('webrtc-signal-http-heartbeat')`

[Function] - takes a [HeartbeatOpts](#heartbeatopts) indicating configuration options. __Returns__ an [express](https://expressjs.com/) `router` object.

#### router.peerList

[Object] - can be used to retrieve a `PeerList` from the express `router`. __Returns__ a [TimeoutPeerList](#timeoutpeerlist) object.

### TimeoutPeerList

[Class] - Extends [PeerList](https://github.com/bengreenier/webrtc-signal-http/#peerlist) with the ability to have peers timeout.

#### refreshPeerTimeout

[Function] - Takes `id` (a Number). Resets the timeout on a peer, keeping it active. __Returns__ nothing.

#### cancelGc

[Function] - Takes nothing. Stops the GC from running. __Returns__ nothing.

### HeartbeatOpts

[Object] - represents the options that can be given to the heartbeat creator

#### timeoutPeriod

[Number] - the timeout period in `ms` after which a client will be marked as stale, and cleaned up when the "gc" runs. Default `30s`

#### gcInterval

[Number] - the interval in `ms` at which the gc will run, removing stale clients. Default `15s`

## License

MIT