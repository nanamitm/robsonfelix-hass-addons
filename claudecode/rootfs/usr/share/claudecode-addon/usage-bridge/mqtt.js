// Minimal MQTT 3.1.1 publisher.
//
// The add-on only ever needs to connect, publish retained QoS 0 messages and
// keep the connection alive, so this is a few hundred bytes of packet encoding
// rather than a dependency. Keeping it dependency-free matters here: the image
// installs no npm packages for the bridge, so there is nothing to audit, pin or
// update, and `npm install` never runs at build time.
//
// Anything this client cannot do - QoS 1/2, subscriptions, in-process
// reconnection - is deliberately absent. The supervisor loop in the entrypoint
// restarts the process instead, and the Last Will covers the case where it is
// killed before it can say goodbye.
import net from "node:net";
import tls from "node:tls";
import { EventEmitter } from "node:events";

const CONNECT = 0x10;
const CONNACK = 0x20;
const PUBLISH = 0x30;
const PINGREQ = 0xc0;
const PINGRESP = 0xd0;
const DISCONNECT = 0xe0;

const CONNACK_ERRORS = {
  1: "unacceptable protocol version",
  2: "client identifier rejected",
  3: "broker unavailable",
  4: "bad username or password",
  5: "not authorised",
};

function encodeLength(value) {
  const bytes = [];
  let remaining = value;
  do {
    let byte = remaining % 128;
    remaining = Math.floor(remaining / 128);
    if (remaining > 0) byte |= 0x80;
    bytes.push(byte);
  } while (remaining > 0);
  return Buffer.from(bytes);
}

function encodeString(value) {
  const payload = Buffer.from(value, "utf8");
  const length = Buffer.alloc(2);
  length.writeUInt16BE(payload.length, 0);
  return Buffer.concat([length, payload]);
}

function packet(header, ...parts) {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([header]), encodeLength(body.length), body]);
}

export class MqttClient extends EventEmitter {
  #socket = null;
  #buffer = Buffer.alloc(0);
  #pingTimer = null;
  #closed = false;

  constructor(options) {
    super();
    this.options = options;
  }

  connect() {
    const { host, port, ssl } = this.options;
    const connector = ssl ? tls.connect : net.connect;
    // Home Assistant's own MQTT integration does not verify the broker
    // certificate either: the Mosquitto add-on ships a self-signed one, and
    // rejecting it would leave `ssl: true` brokers unusable.
    const socketOptions = ssl
      ? { host, port, rejectUnauthorized: false }
      : { host, port };

    this.#socket = connector(socketOptions, () => this.#sendConnect());
    this.#socket.setNoDelay(true);
    this.#socket.on("data", (chunk) => this.#onData(chunk));
    this.#socket.on("error", (error) => this.#fail(error));
    this.#socket.on("close", () => {
      if (!this.#closed) this.#fail(new Error("broker closed the connection"));
    });
  }

  #fail(error) {
    if (this.#closed) return;
    this.#closed = true;
    this.#stopPing();
    this.#socket?.destroy();
    this.emit("error", error);
  }

  #sendConnect() {
    const { clientId, username, password, keepAlive, will } = this.options;

    let flags = 0x02; // clean session
    const payload = [encodeString(clientId)];

    if (will) {
      flags |= 0x04;
      if (will.retain) flags |= 0x20;
      payload.push(encodeString(will.topic), encodeString(will.payload));
    }
    if (username) {
      flags |= 0x80;
      payload.push(encodeString(username));
    }
    if (password) {
      flags |= 0x40;
      payload.push(encodeString(password));
    }

    const variable = Buffer.alloc(4);
    variable.writeUInt8(4, 0); // protocol level 3.1.1
    variable.writeUInt8(flags, 1);
    variable.writeUInt16BE(keepAlive, 2);

    this.#write(packet(CONNECT, encodeString("MQTT"), variable, ...payload));
  }

  publish(topic, payload, { retain = false } = {}) {
    const header = PUBLISH | (retain ? 0x01 : 0x00);
    this.#write(
      packet(header, encodeString(topic), Buffer.from(payload, "utf8")),
    );
  }

  end() {
    if (this.#closed) return;
    this.#closed = true;
    this.#stopPing();
    try {
      this.#write(packet(DISCONNECT));
    } catch {
      // The socket is already gone; the Last Will covers it.
    }
    this.#socket?.end();
  }

  #write(buffer) {
    if (!this.#socket || this.#socket.destroyed) return;
    this.#socket.write(buffer);
  }

  #startPing() {
    const interval = Math.max(1, Math.floor(this.options.keepAlive / 2)) * 1000;
    this.#pingTimer = setInterval(() => this.#write(packet(PINGREQ)), interval);
    this.#pingTimer.unref();
  }

  #stopPing() {
    if (this.#pingTimer) clearInterval(this.#pingTimer);
    this.#pingTimer = null;
  }

  #onData(chunk) {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);

    while (this.#buffer.length >= 2) {
      // Decode the remaining-length varint. Bailing out on an incomplete one
      // leaves the bytes in the buffer for the next chunk.
      let multiplier = 1;
      let length = 0;
      let offset = 1;
      let byte;
      do {
        if (offset >= this.#buffer.length) return;
        byte = this.#buffer[offset++];
        length += (byte & 0x7f) * multiplier;
        multiplier *= 128;
      } while ((byte & 0x80) !== 0);

      if (this.#buffer.length < offset + length) return;

      const type = this.#buffer[0] & 0xf0;
      const body = this.#buffer.subarray(offset, offset + length);
      this.#buffer = this.#buffer.subarray(offset + length);

      if (type === CONNACK) {
        const code = body[1];
        if (code !== 0) {
          this.#fail(
            new Error(
              `broker refused the connection: ${CONNACK_ERRORS[code] ?? `code ${code}`}`,
            ),
          );
          return;
        }
        this.#startPing();
        this.emit("connect");
      } else if (type === PINGRESP) {
        // Nothing to do: the broker is alive, which is the whole point.
      }
    }
  }
}
