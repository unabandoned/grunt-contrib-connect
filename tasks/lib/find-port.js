/*
 * Find the first port in [start, end] that nothing is listening on.
 *
 * Replaces portscanner's findAPortNotInUse with the same probe: a port is
 * "in use" if a TCP connection to it succeeds, and free if the connection is
 * refused or times out.
 *
 * Licensed under the MIT license.
 */

'use strict';

var net = require('net');

var TIMEOUT = 400;

function isInUse(port, host) {
  return new Promise(function(resolve) {
    var settled = false;
    var socket = net.connect({port: port, host: host});

    function finish(inUse) {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(inUse);
    }

    socket.setTimeout(TIMEOUT);
    socket.once('connect', function() {
      finish(true);
    });
    socket.once('timeout', function() {
      finish(false);
    });
    socket.once('error', function() {
      finish(false);
    });
  });
}

async function findPort(start, end, host) {
  for (var port = start; port <= end; port++) {
    if (!(await isInUse(port, host))) {
      return port;
    }
  }
  throw new Error('No open ports found in between ' + start + ' and ' + end);
}

module.exports = findPort;
module.exports.isInUse = isInUse;
