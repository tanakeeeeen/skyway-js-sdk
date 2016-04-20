'use strict';

const EventEmitter = require('events');
const Enum         = require('enum');

const shim         = require('../src/webrtcShim');

const RTCPeerConnection     = shim.RTCPeerConnection;
const RTCIceCandidate       = shim.RTCIceCandidate;
const RTCSessionDescription = shim.RTCSessionDescription;

const util = require('./util');

const RoomNegotiatorEvents = new Enum([
  'addStream',
  'dcReady',
  'offerCreated',
  'answerCreated',
  'iceCandidate',
  'iceConnectionDisconnected',
  'error'
]);

class RoomNegotiator extends EventEmitter {
  startConnection(options, pcConfig) {
    this._pc = this._createPeerConnection(pcConfig);
    this._setupPCListeners();

    if (options.type === 'room' && options._stream) {
      this._pc.addStream(options._stream);
    }
  }

  _createPeerConnection(pcConfig) {
    util.log('Creating RTCPeerConnection');

    // Calling RTCPeerConnection with an empty object causes an error
    // Either give it a proper pcConfig or undefined
    return new RTCPeerConnection(pcConfig);
  }

  _setupPCListeners() {
    this._pc.onaddstream = evt => {
      // Do we need RoomNegotiator, or can we simply repurpose this?
      util.log('Received remote media stream');
      const stream = evt.stream;
      this.emit(Negotiator.EVENTS.addStream.key, stream);
    };

    this._pc.onicecandidate = evt => {
      const candidate = evt.candidate;
      if (candidate) {
        util.log('Generated ICE candidate for:', candidate);
        this.emit(Negotiator.EVENTS.iceCandidate.key, candidate);
      } else {
        util.log('ICE canddidates gathering complete');
      }
    };

    this._pc.oniceconnectionstatechange = () => {
      switch (this._pc.iceConnectionState) {
        case 'new':
          util.log('iceConnectionState is new');
          break;
        case 'checking':
          util.log('iceConnectionState is checking');
          break;
        case 'connected':
          util.log('iceConnectionState is connected');
          break;
        case 'completed':
          util.log('iceConnectionState is completed');
          this._pc.onicecandidate = () => {};
          break;
        case 'failed':
          util.log('iceConnectionState is failed, closing connection');
          this.emit(Negotiator.EVENTS.iceConnectionDisconnected.key);
          break;
        case 'disconnected':
          util.log('iceConnectionState is disconnected, closing connection');
          this.emit(Negotiator.EVENTS.iceConnectionDisconnected.key);
          break;
        case 'closed':
          util.log('iceConnectionState is closed');
          break;
        default:
          break;
      }
    };

    this._pc.onnegotiationneeded = () => {
      util.log('`negotiationneeded` triggered');

      // don't make a new offer if it's not stable
      if (this._pc.signalingState === 'stable') {
        this._makeOfferSdp()
          .then(offer => {
            this._setLocalDescription(offer);
          });
      }
    };

    this._pc.onremovestream = () => {
      util.log('`removestream` triggered');
    };

    this._pc.onsignalingstatechange = () => {
      switch (this._pc.signalingState) {
        case 'stable':
          util.log('signalingState is stable');
          break;
        case 'have-local-offer':
          util.log('signalingState is have-local-offer');
          break;
        case 'have-remote-offer':
          util.log('signalingState is have-remote-offer');
          break;
        case 'have-local-pranswer':
          util.log('signalingState is have-local-pranswer');
          break;
        case 'have-remote-pranswer':
          util.log('signalingState is have-remote-pranswer');
          break;
        case 'closed':
          util.log('signalingState is closed');
          break;
        default:
          break;
      }
    };

    return this._pc;
  }

  _makeOfferSdp() {
    return new Promise((resolve, reject) => {
      this._pc.createOffer(offer => {
        util.log('Created offer.');
        resolve(offer);
      }, error => {
        this.emitError('webrtc', error);
        util.log('Failed to createOffer, ', error);
        reject(error);
      });
    });
  }

  _setLocalDescription(offer) {
    return new Promise((resolve, reject) => {
      this._pc.setLocalDescription(offer, () => {
        util.log('Set localDescription: offer');
        this.emit(Negotiator.EVENTS.offerCreated.key, offer);
        resolve(offer);
      }, error => {
        this.emitError('webrtc', error);
        util.log('Failed to setLocalDescription, ', error);
        reject(error);
      });
    });
  }

  cleanup() {
    util.log('Cleaning up PeerConnection');

    if (this._pc && (this._pc.readyState !== 'closed' || this._pc.signalingState !== 'closed')) {
      this._pc.close();
      this._pc = null;
    }
  }

  handleOffer(offerSdp) {
    this._setRemoteDescription(offerSdp)
      .then(() => {
        return this._makeAnswerSdp();
      }).then(answer => {
        this.emit(Negotiator.EVENTS.answerCreated.key, answer);
      });
  }

  handleAnswer(answerSdp) {
    this._setRemoteDescription(answerSdp);
  }

  handleCandidate(candidate) {
    this._pc.addIceCandidate(new RTCIceCandidate(candidate));
    util.log('Added ICE candidate');
  }

  _setRemoteDescription(sdp) {
    util.log(`Setting remote description ${JSON.stringify(sdp)}`);
    return new Promise(resolve => {
      this._pc.setRemoteDescription(new RTCSessionDescription(sdp), () => {
        util.log('Set remoteDescription:', sdp.type);
        resolve();
      }, err => {
        this.emitError('webrtc', err);
        util.log('Failed to setRemoteDescription: ', err);
      });
    });
  }

  _makeAnswerSdp() {
    return new Promise(resolve => {
      this._pc.createAnswer(answer => {
        util.log('Created answer.');

        this._pc.setLocalDescription(answer, () => {
          util.log('Set localDescription: answer');
          resolve(answer);
        }, err => {
          this.emitError('webrtc', err);
          util.log('Failed to setLocalDescription, ', err);
        });
      }, err => {
        this.emitError('webrtc', err);
        util.log('Failed to createAnswer, ', err);
      });
    });
  }

  emitError(type, err) {
    util.error('Error:', err);
    if (typeof err === 'string') {
      err = new Error(err);
    }

    err.type = type;
    this.emit(Negotiator.EVENTS.error.key, err);
  }

  static get EVENTS() {
    return NegotiatorEvents;
  }
}

module.exports = Negotiator;
