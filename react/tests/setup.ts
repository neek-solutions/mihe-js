/**
 * Tell React it is running inside a test renderer, so `act()` flushes effects
 * instead of warning on every call.
 */

import { Storage } from "happy-dom";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Node's own localStorage can shadow the browser environment without a
// backing file. Orb persistence belongs to this DOM, never to the host Node
// process or a file shared by test workers.
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: new Storage(),
});
