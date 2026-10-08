/*
 * A minimal, dependency-free stand-in for the `connect` module (3.x).
 *
 * grunt-contrib-connect only ever used connect as a middleware stack, and it
 * hands the module to user `middleware` and `onCreateServer` callbacks, so this
 * keeps connect's public surface: `createApp()` returns a request handler with
 * `use([route,] fn)`, `handle(req, res, out)` and `listen(...)`, routes match
 * on path-segment boundaries and are stripped from `req.url`, `req.originalUrl`
 * is preserved, and four-argument middleware receives errors.
 *
 * Licensed under the MIT license.
 */

'use strict';

var http = require('http');
var EventEmitter = require('events').EventEmitter;

function pathnameOf(url) {
  var end = url.length;
  var q = url.indexOf('?');
  var h = url.indexOf('#');
  if (q !== -1) {
    end = q;
  }
  if (h !== -1 && h < end) {
    end = h;
  }
  return url.slice(0, end);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Respond once the stack is exhausted: 404 for unhandled requests, the
// error's status (or 500) otherwise. Mirrors connect's finalhandler output.
function finalHandler(req, res, err) {
  if (res.headersSent) {
    if (req.socket) {
      req.socket.destroy();
    }
    return;
  }

  var status = 404;
  var message = 'Cannot ' + req.method + ' ' + escapeHtml(pathnameOf(req.originalUrl || req.url));

  if (err) {
    status = err.status || err.statusCode;
    if (typeof status !== 'number' || status < 400 || status > 599) {
      status = 500;
    }
    message = status >= 500 ? (http.STATUS_CODES[status] || 'Internal Server Error') : escapeHtml(err.message || http.STATUS_CODES[status]);
    if (status >= 500 && process.env.NODE_ENV !== 'test') {
      console.error(err.stack || String(err));
    }
  }

  var body = '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Error</title>\n</head>\n<body>\n<pre>' +
    message + '</pre>\n</body>\n</html>\n';

  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(body));
  res.setHeader('Content-Security-Policy', "default-src 'none'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'HEAD') {
    res.end();
  } else {
    res.end(body);
  }
}

function call(handle, route, err, req, res, next) {
  var arity = handle.length;
  var error = err;
  var hasError = Boolean(err);

  try {
    if (hasError && arity === 4) {
      handle(err, req, res, next);
      return;
    } else if (!hasError && arity < 4) {
      handle(req, res, next);
      return;
    }
  } catch (e) {
    error = e;
  }

  next(error);
}

function createApp() {
  function app(req, res, next) {
    app.handle(req, res, next);
  }

  // Like connect, mix EventEmitter in rather than re-parenting the function,
  // so app.call/app.apply (used by http.Server) keep working.
  Object.getOwnPropertyNames(EventEmitter.prototype).forEach(function(name) {
    if (name !== 'constructor') {
      Object.defineProperty(app, name, Object.getOwnPropertyDescriptor(EventEmitter.prototype, name));
    }
  });
  EventEmitter.call(app);

  app.route = '/';
  app.stack = [];

  app.use = function use(route, fn) {
    var handle = fn;
    var path = route;

    if (typeof route !== 'string') {
      handle = route;
      path = '/';
    }

    // Mounting another app: delegate to its handle().
    if (typeof handle.handle === 'function') {
      var server = handle;
      server.route = path;
      handle = function(req, res, next) {
        server.handle(req, res, next);
      };
    }

    if (path[path.length - 1] === '/') {
      path = path.slice(0, -1);
    }

    app.stack.push({route: path, handle: handle});
    return app;
  };

  app.handle = function handle(req, res, out) {
    var index = 0;
    var removed = '';
    var slashAdded = false;
    var stack = app.stack;

    req.originalUrl = req.originalUrl || req.url;

    function next(err) {
      if (slashAdded) {
        req.url = req.url.slice(1);
        slashAdded = false;
      }
      if (removed.length !== 0) {
        req.url = removed + req.url;
        removed = '';
      }

      var layer = stack[index++];

      if (!layer) {
        setImmediate(function() {
          if (out) {
            out(err);
          } else {
            finalHandler(req, res, err);
          }
        });
        return;
      }

      var path = pathnameOf(req.url) || '/';
      var route = layer.route;

      // Skip if the route does not match on a path-segment boundary.
      if (path.toLowerCase().slice(0, route.length) !== route.toLowerCase()) {
        return next(err);
      }
      var c = path.length > route.length && path[route.length];
      if (c && c !== '/' && c !== '.') {
        return next(err);
      }

      if (route.length !== 0 && route !== '/') {
        removed = route;
        req.url = req.url.slice(removed.length);
        if (req.url[0] !== '/') {
          req.url = '/' + req.url;
          slashAdded = true;
        }
      }

      call(layer.handle, route, err, req, res, next);
    }

    next();
  };

  app.listen = function listen() {
    var server = http.createServer(app);
    return server.listen.apply(server, arguments);
  };

  return app;
}

module.exports = createApp;
