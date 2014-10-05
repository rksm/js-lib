/*global beforeEach, afterEach, describe, it, setTimeout*/

var expect = typeof module !== 'undefined' && module.require ?
  module.require('expect.js') : this.expect;

var jsext = typeof module !== 'undefined' && module.require ?
  module.require('../index') : this.jsext;

var message = jsext.message;
var fun = jsext.fun;
var arr = jsext.arr;

function createMessenger(messengers, options) {

  var keys = ['id', 'send', 'listen', 'isOnline', 'close',
              'allowConcurrentSends', 'sendTimeout',
              'sendHeartbeat', 'heartbeatInterval'];

  var spec = keys.reduce(function(spec, k) {
    if (options[k]) spec[k] = options[k];
    return spec;
  }, {});

  if (!spec.send) spec.send = function(msg, onSendDone) {
    function doSend() {
      if (options.sendData) options.sendData.push(msg);
      onSendDone();
    }
    if (typeof options.sendDelay === 'number') setTimeout(doSend, options.sendDelay);
    else doSend();
  };

  if (!spec.receive) spec.receive = function(msg) {
    function doReceive() {
      if (options.receivedData) options.receivedData.push(msg);
    }
    if (typeof options.receiveDelay === 'number') setTimeout(doReceive, options.reveiveDelay);
    else doReceive();
  };

  var listening = false;
  if (!spec.listen) {
    spec.listen = function(thenDo) {
      function doListen() {
        listening = true; thenDo(null); }
      if (typeof options.listenDelay === 'number') setTimeout(doListen, options.listenDelay);
      else doListen();
    };
  }

  if (!spec.close) {
    spec.close = function(thenDo) {
      function doClose() {
        listening = false; thenDo(null); }
      if (typeof options.closeDelay === 'number') setTimeout(doClose, options.closeDelay);
      else doClose();
    };
  }

  if (!spec.isOnline) spec.isOnline = function() { return !!listening; };

  var messenger = message.makeMessenger(spec);
  messengers.push(messenger);
  return messenger;
}

describe('messengers', function() {

  var sendData = [], messenger,
      messengers;

  beforeEach(function() {
    messengers = [];

    sendData = [], messenger = createMessenger(messengers, {
      id: "messengerA",
      sendDelay: 20, listenDelay: 10,
      sendData: sendData
    });
  });

  afterEach(function(done) {
    fun.waitForAll(jsext.arr.pluck(messengers, 'close'), done);
  });

  describe("messenger attributes", function() {

    it("have ids", function() {
      expect(messenger.id()).to.be("messengerA");
      expect(createMessenger(messengers, {}).id()).to.match(/^[a-z0-9-]+$/i);
    });

  });

  describe("sending basics", function() {

    it('sends messages one by one', function(done) {
      var msg1 = {target: "foo", action: "test", data: "some data"},
          msg2 = {target: "foo", action: "test2", data: "some more data"};

      fun.composeAsync(
        function(next) { messenger.send(msg1); messenger.send(msg2); next(); },
        function(next) {
          fun.waitForAll({timeout: 200}, [messenger.whenOnline], next)
          messenger.listen();
        },
        function(_, next) {
          expect(sendData).to.be.empty();
          expect(messenger.outgoingMessages()).to.eql([msg1, msg2]);
          next();
        },
        function(next) { setTimeout(next, 25); },
        function(next) {
          expect(sendData).to.eql([msg1]);
          expect(messenger.outgoingMessages()).to.eql([msg2]);
          next();
        },
        function(next) { setTimeout(next, 25); },
        function(next) {
          expect(sendData).to.eql([msg1, msg2]);
          expect(messenger.outgoingMessages()).to.have.length(0);
          next();
        }
      )(function(err) { expect(err).to.be(null); done(); })

    });

    it('sends messages concurrently', function(done) {
      var msg1 = {target: "foo", action: "test", data: "some data"},
          msg2 = {target: "bar", action: "test2", data: "some more data"};

      var sendData = [];
      var messengerB = createMessenger(messengers, {
        id: "messengerB",
        allowConcurrentSends: true,
        sendDelay: 20, listenDelay: 10,
        sendData: sendData
      });

      fun.composeAsync(
        function(next) {
          fun.waitForAll({timeout: 200}, [messengerB.whenOnline], next)
          messengerB.listen();
        },
        function(_, next) { messengerB.send(msg1); messengerB.send(msg2); next(); },
        function(next) {
          expect(sendData).to.be.empty();
          expect(messengerB.outgoingMessages()).to.eql([msg1, msg2]);
          next();
        },
        function(next) { setTimeout(next, 25); },
        function(next) {
          expect(sendData).to.eql([msg1, msg2]);
          expect(messengerB.outgoingMessages()).to.have.length(0);
          next();
        }
      )(function(err) { expect(err).to.be(null); done(); })

    });

    it('sends can time out', function(done) {
      var msg = {target: "foo", action: "test", data: "some data"};

      var sendData = [];
      var sendErr;
      var messengerB = createMessenger(messengers, {
        id: "messengerB",
        sendTimeout: 20, sendDelay: 30,
        sendData: sendData
      });

      fun.composeAsync(
        function(next) {
          fun.waitForAll({timeout: 200}, [messengerB.whenOnline], next)
          messengerB.listen();
        },
        function(_, next) {
          messengerB.send(msg, function(err) { sendErr = err; });
          next();
        },
        function(next) { setTimeout(next, 25); },
        function(next) {
          expect(sendData).to.be.empty();
          expect(messengerB.outgoingMessages()).to.be.empty();
          next();
        }
      )(function(err) {
        expect(err).to.be(null);
        expect(String(sendErr)).to.match(/Timeout sending message/)
        done();
      });

    });

    it('can send heartbeat messages', function(done) {
      var sendData = [], heartbeats = [];
      var messengerB = createMessenger(messengers, {
        id: "messengerB",
        sendDelay: 10, listenDelay: 10,
        sendData: sendData,
        heartbeatInterval: 30,
        sendHeartbeat: function(thenDo) {
          var msg = {target: "someone", action: "heartbeat", data: {time: Date.now}}
          heartbeats.push(msg);
          messengerB.send(msg, thenDo);
        }
      });

      fun.composeAsync(
        function(next) {
          fun.waitForAll({timeout: 200}, [messengerB.whenOnline], next)
          messengerB.listen();
        },
        function(_, next) { setTimeout(next, 70); },
        function(next) {
          expect(sendData).to.be.eql(heartbeats);
          next();
        }
      )(function(err) { expect(err).to.be(null); done(); });

    });

  });

  describe('status', function() {

    it('can auto reconnect', function(done) {
      var isOnline = true
      var messengerB = createMessenger(messengers, {
        id: "messengerB",
        sendData: sendData,
        isOnline: function() { return isOnline; },
        listen: function(thenDo) { isOnline = true; thenDo(null); },
        close: function(thenDo) { isOnline = false; thenDo(null); },
        autoReconnect: true
      });

      fun.composeAsync(
        function(next) {
          fun.waitForAll({timeout: 200}, [messengerB.whenOnline], next)
          messengerB.listen();
        },
        function(_, next) { expect(isOnline).to.be(true); next(); },
        function(next) { isOnline = false; next(); },
        function(next) { setTimeout(next, 70); },
        function(next) { expect(isOnline).to.be(true); messengerB.close(next); },
        function(next) { setTimeout(next, 70); },
        function(next) { expect(isOnline).to.be(false); next(); }
      )(function(err) { expect(err).to.be(null); done(); });

    });

  });

  describe('send and receive', function() {

    function findMessengerForMsg(msg) {
      if (!msg || !msg.target) throw new Error("findMessengerForMsg: msg is strange: " + jsext.obj.inspect(msg));
      return arr.detect(messengers, function(ea) { return ea.id() === msg.target; });
    }

    function genericSend(msg, sendDone) {
      var messenger = findMessengerForMsg(msg);
      if (!messenger) sendDone(new Error("Target " + msg.target + " not found"));
      else {
        messenger.receive(msg);
        sendDone();
      }
    }

    var messengerB, messengerC;
    var receivedB, receivedC;

    beforeEach(function() {
      receivedB = [];
      messengerB = createMessenger(messengers, {
        id: "messengerB",
        sendDelay: 20, listenDelay: 10,
        receivedData: receivedB,
        send: genericSend
      });
      receivedC = [];
      messengerC = createMessenger(messengers, {
        id: "messengerC",
        sendDelay: 20, listenDelay: 10,
        receivedData: receivedC,
        send: genericSend
      });
    });

    it('sends messages between messengers', function(done) {
      fun.composeAsync(
        function(next) {
          fun.waitForAll({timeout: 200}, [messengerB.whenOnline, messengerC.whenOnline], next)
          messengerB.listen(); messengerC.listen();
        },
        function(_, next) {
          messengerB.send({target: "messengerC", action: "test", data: 'foo'});
          next();
        },
        function(next) {
          expect(receivedB).to.be.empty();
          expect(receivedC).to.have.length(1);
          expect(receivedC[0].data).to.be("foo");
          messengerC.answer(receivedC[0], 'baz');
          expect(receivedB).to.have.length(1);
          expect(receivedB[0].data).to.be("baz");
          next();
        }
      )(function(err) { expect(err).to.be(null); done(); });

    });

    it('send callback gets triggered on answer', function(done) {
      fun.composeAsync(
        function(next) {
          fun.waitForAll({timeout: 200}, [messengerB.whenOnline, messengerC.whenOnline], next)
          messengerB.listen(); messengerC.listen();
        },
        function(_, next) {
          var msg = messengerB.send({target: "messengerC", action: "test", data: 'foo'}, function(err, answer) {
            expect(err).to.be(null);
            expect(answer.data).to.be('baz');
            next();
          });
          messengerC.answer(msg, 'baz');
        }
      )(function(err) { expect(err).to.be(null); done(); });
    });

    it('ignores multiple answers send without expect more flag', function(done) {
      fun.composeAsync(
        function(next) {
          fun.waitForAll({timeout: 200}, [messengerB.whenOnline, messengerC.whenOnline], next)
          messengerB.listen(); messengerC.listen();
        },
        function(_, next) {
          var answerCallbackCalled = 0;
          var msg = messengerB.send({target: "messengerC", action: "test", data: 'foo'}, function(err, answer) {
            answerCallbackCalled++;
          });
          messengerC.answer(msg, 'baz1');
          messengerC.answer(msg, 'baz2');
          expect(answerCallbackCalled).to.be(1);
          next();
        }
      )(function(err) { expect(err).to.be(null); done(); });
    });

    it('invokes answer callback multiple times when send with expect more flag', function(done) {
      fun.composeAsync(
        function(next) {
          fun.waitForAll({timeout: 200}, [messengerB.whenOnline, messengerC.whenOnline], next)
          messengerB.listen(); messengerC.listen();
        },
        function(_, next) {
          var answerCallbackCalled = 0;
          var msg = messengerB.send({target: "messengerC", action: "test", data: 'foo'}, function(err, answer) {
            answerCallbackCalled++;
          });
          messengerC.answer(msg, 'baz1', true);
          messengerC.answer(msg, 'baz2', false);
          expect(answerCallbackCalled).to.be(2);
          next();
        }
      )(function(err) { expect(err).to.be(null); done(); });
    });

  });
});

