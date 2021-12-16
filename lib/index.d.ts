import PeerList from "./peer-list";
import { IPeerRequest, IPeerResponse, IRouter, IRouterOpts } from "./utils";
declare function signalRouterCreator(opts: IRouterOpts): IRouter;
declare function heartbeatRouterCreator(opts: any): any;
export { IPeerRequest, PeerList, signalRouterCreator, heartbeatRouterCreator, IPeerResponse };
