'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var path = require('node:path');
var http = require('node:http');
var https = require('node:https');
var http2 = require('node:http2');
var net = require('node:net');
var grunt = require('grunt');

var connect = require('../tasks/lib/app');
var findPort = require('../tasks/lib/find-port');

var root = path.join(__dirname, '..');

function get(url) {
  return new Promise(function(resolve, reject) {
    var client = http;
    if (typeof url === 'object' && url.scheme === 'https') {
      client = https;
      url = Object.assign({}, url);
      delete url.scheme;
    }
    client.get(url, function(res) {
      var body = '';
      res.setEncoding('utf8');
      res.on('data', function(chunk) {
        body += chunk;
      }).on('end', function() {
        resolve({res: res, body: body});
      });
    }).on('error', reject);
  });
}

function getHttp2(port, reqPath) {
  return new Promise(function(resolve, reject) {
    var session = http2.connect('https://localhost:' + port, {rejectUnauthorized: false});
    session.on('error', reject);
    var req = session.request({':path': reqPath, accept: 'text/plain'});
    var headers;
    var body = '';
    req.setEncoding('utf8');
    req.on('response', function(h) {
      headers = h;
    });
    req.on('data', function(chunk) {
      body += chunk;
    });
    req.on('end', function() {
      session.close();
      resolve({headers: headers, body: body});
    });
    req.on('error', reject);
    req.end();
  });
}

function local(port, reqPath, accept) {
  return {hostname: 'localhost', port: port, path: reqPath, headers: {accept: accept || 'text/plain'}};
}

test.before(function() {
  global.__connectTestServers = [];
  return new Promise(function(resolve) {
    grunt.tasks(['connect'], {gruntfile: path.join(root, 'Gruntfile.js'), base: root}, resolve);
  });
});

test.after(function() {
  global.__connectTestServers.forEach(function(server) {
    if (server.closeAllConnections) {
      server.closeAllConnections();
    }
    server.close();
  });
});

test('custom_base', async function() {
  var r = await get(local(8000, '/fixtures/hello.txt'));
  assert.equal(r.res.statusCode, 200);
  assert.equal(r.body, 'Hello world');
});

test('custom_port', async function() {
  var r = await get(local(8001, '/fixtures/hello.txt'));
  assert.equal(r.res.statusCode, 200);
  assert.equal(r.body, 'Hello world');
});

test('custom_http2', async function() {
  var r = await getHttp2(8017, '/fixtures/hello.txt');
  assert.equal(r.headers[':status'], 200);
  assert.equal(r.body, 'Hello world');
});

test('http2 server still answers HTTPS/1.1 clients', async function() {
  var r = await get(Object.assign({scheme: 'https', rejectUnauthorized: false}, local(8017, '/fixtures/hello.txt')));
  assert.equal(r.res.httpVersion, '1.1');
  assert.equal(r.res.statusCode, 200);
  assert.equal(r.body, 'Hello world');
});

test('custom_https', async function() {
  var r = await get(Object.assign({scheme: 'https', rejectUnauthorized: false}, local(8002, '/fixtures/hello.txt')));
  assert.equal(r.res.statusCode, 200);
  assert.equal(r.body, 'Hello world');
});

test('custom_https_certs', async function() {
  var r = await get(Object.assign({scheme: 'https', rejectUnauthorized: false}, local(8003, '/fixtures/hello.txt')));
  assert.equal(r.res.statusCode, 200);
  assert.equal(r.body, 'Hello world');
});

test('custom_base_with_options', async function() {
  var r = await get(local(8014, '/'));
  assert.equal(r.res.statusCode, 200);
  assert.equal(r.body, 'Hello world');
});

test('multiple_base', async function() {
  var r = await get(local(8004, '/fixtures/hello.txt'));
  assert.equal(r.res.statusCode, 200);
  assert.equal(r.res.headers['content-type'], 'text/plain; charset=utf-8');
  r = await get('http://localhost:8004/connect-examples.md');
  assert.equal(r.res.headers['content-type'], 'text/markdown; charset=utf-8');
  assert.equal(r.res.statusCode, 200);
});

test('multiple_base_with_options', async function() {
  var r = await get(local(8015, '/'));
  assert.equal(r.res.statusCode, 200);
  assert.equal(r.body, 'Hello world');
  assert.match(r.res.headers['cache-control'], /max-age=0/);
  r = await get('http://localhost:8015/connect-examples.md');
  assert.match(r.res.headers['cache-control'], /max-age=300/);
  assert.equal(r.res.statusCode, 200);
});

test('multiple_base_directory', async function() {
  var r = await get(local(8005, '/', 'text/html'));
  assert.equal(r.res.statusCode, 200);
  assert.ok(r.body.indexOf('hello.txt') !== -1, 'listing should contain hello.txt');
  r = await get('http://localhost:8005/fixtures/hello.txt');
  assert.equal(r.res.statusCode, 200);
  assert.equal(r.body, 'Hello world');
});

test('livereload', async function() {
  var r = await get(local(8006, '/livereload.html', 'text/html'));
  assert.ok(r.body.indexOf('35729/livereload.js') !== -1, 'should contain livereload snippet');
  r = await get(local(8006, '/livereload.html?a=1&b=2#id', 'text/html'));
  assert.ok(r.body.indexOf('35729/livereload.js') !== -1, 'should contain livereload snippet');
  assert.equal(Number(r.res.headers['content-length']), Buffer.byteLength(r.body));
});

test('livereload_port', async function() {
  var r = await get(local(8018, '/livereload.html', 'text/html'));
  assert.ok(r.body.indexOf('12345/livereload.js') !== -1);
  r = await get(local(8018, '/livereload.html?a=1&b=2#id', 'text/html'));
  assert.ok(r.body.indexOf('12345/livereload.js') !== -1);
});

test('livereload_general', async function() {
  var src = 'https://example.org:54321/livereload.js?snipver=1';
  var r = await get(local(8019, '/livereload.html', 'text/html'));
  assert.ok(r.body.indexOf(src) !== -1);
  r = await get(local(8019, '/livereload.html?a=1&b=2#id', 'text/html'));
  assert.ok(r.body.indexOf(src) !== -1);
});

test('custom_middleware', async function() {
  var r = await get(local(8007, '/hello/world'));
  assert.equal(r.res.statusCode, 200);
  assert.equal(r.body, 'Hello from port 8007');
  r = await get(local(8007, '/fixtures/hello.txt'));
  assert.equal(r.res.statusCode, 200);
  assert.equal(r.body, 'Hello world');
});

test('null_middleware_should_use_default_middleware', async function() {
  var r = await get(local(8008, '/fixtures/hello.txt'));
  assert.equal(r.res.statusCode, 200);
  assert.equal(r.body, 'Hello world');
});

test('empty_middleware_should_404_everything', async function() {
  var r = await get(local(8009, '/fixtures/hello.txt'));
  assert.equal(r.res.statusCode, 404);
  assert.match(r.body, /Cannot GET \/fixtures\/hello\.txt/);
});

test('custom_middleware_can_patch_default_middleware', async function() {
  var r = await get(local(8010, '/hello/world'));
  assert.equal(r.res.statusCode, 200);
  assert.equal(r.body, 'Hello, world from port #8010!');
  r = await get(local(8010, '/fixtures/hello.txt'));
  assert.equal(r.res.statusCode, 200);
  assert.equal(r.body, 'Hello world');
});

test('allHostname', async function() {
  var r = await get('http://localhost:8012/fixtures/hello.txt');
  assert.equal(r.res.statusCode, 200);
  r = await get('http://127.0.0.1:8012/fixtures/hello.txt');
  assert.equal(r.res.statusCode, 200);
  if (process.platform !== 'win32') {
    r = await get('http://0.0.0.0:8012/fixtures/hello.txt');
    assert.equal(r.res.statusCode, 200);
  }
});

test('onCreateServer', async function() {
  await get('http://localhost:8013/hello');
  assert.ok(grunt.config.data.connect.onCreateServer.test, 'should set configuration object on request');
});

test('routedMiddleware', async function() {
  var r = await get('http://localhost:8016/mung');
  assert.equal(r.body, 'Yay');
});

test('ephemeral ports are reported back into the config', function() {
  var q = grunt.config.get('connect.self_port_q.options.port');
  var zero = grunt.config.get('connect.self_port_0.options.port');
  assert.ok(q > 0, 'port "?" should resolve to the bound port');
  assert.ok(zero > 0, 'port 0 should resolve to the bound port');
});

test('find-port skips ports that are in use', async function() {
  var server = net.createServer();
  await new Promise(function(resolve) {
    server.listen(0, '127.0.0.1', resolve);
  });
  var busy = server.address().port;
  try {
    assert.equal(await findPort.isInUse(busy, '127.0.0.1'), true);
    var found = await findPort(busy, busy + 30, '127.0.0.1');
    assert.notEqual(found, busy);
  } finally {
    server.close();
  }
});

test('app: routes match on segment boundaries and strip the mount path', async function() {
  var app = connect();
  var seen = [];
  app.use('/mount', function(req, res, next) {
    seen.push([req.url, req.originalUrl]);
    next();
  });
  app.use(function(req, res) {
    res.end('end:' + req.url);
  });
  var server = app.listen(0, '127.0.0.1');
  await new Promise(function(resolve) {
    server.on('listening', resolve);
  });
  var port = server.address().port;
  try {
    var r = await get('http://127.0.0.1:' + port + '/mount/a?x=1');
    assert.equal(r.body, 'end:/mount/a?x=1');
    await get('http://127.0.0.1:' + port + '/mountain');
    assert.deepEqual(seen, [['/a?x=1', '/mount/a?x=1']]);
  } finally {
    server.close();
  }
});

test('app: errors skip to four-argument middleware', async function() {
  var app = connect();
  app.use(function() {
    throw new Error('boom');
  });
  app.use(function(req, res) {
    res.end('not reached');
  });
  app.use(function(err, req, res, next) {
    res.statusCode = 418;
    res.end(err.message);
  });
  var server = app.listen(0, '127.0.0.1');
  await new Promise(function(resolve) {
    server.on('listening', resolve);
  });
  try {
    var r = await get('http://127.0.0.1:' + server.address().port + '/');
    assert.equal(r.res.statusCode, 418);
    assert.equal(r.body, 'boom');
  } finally {
    server.close();
  }
});
